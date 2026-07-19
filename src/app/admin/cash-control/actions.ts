"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import {
  isCompositePaymentMethod,
  paymentMethodBucketKey,
  PAYMENT_BUCKET_LABELS,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import { loadPaymentEntryPayload, type PaymentEntryPayload } from "@/lib/payment-entry-payload";
import type { PaymentLine } from "@/lib/payment-updated";
import { ensureDocumentsTable } from "@/lib/documents/ensure";
import {
  computeCashControlOrderBalance,
  fixCashUsd,
  toCashControlOrderComputed,
  CASH_CONTROL_EPS,
} from "@/lib/cash-control-calculation";
import {
  buildCashControlMethodSummary,
  type CashControlMethodSummaryPayload,
} from "@/lib/cash-control-method-summary";
import {
  buildCashReconciliationSummary,
  type CashReconciliationLineId,
  type CashReconciliationSummaryPayload,
} from "@/lib/cash-control-reconciliation";
import {
  cashControlWeekCashPaymentsWhere,
  cashControlWeekPaymentsWhere,
  cashControlWeekReconciliationPaymentsWhere,
} from "@/lib/cash-control-week-payments";
import { groupByActivePayments } from "@/lib/payment-record-status";
import {
  computeCashControlDeviations,
  computeMethodDeviationsLegacy,
} from "@/lib/cash-control-deviations";
import {
  CASH_EXPENSE_REASONS,
  type CashCurrency,
  type CashExpenseReason,
} from "./constants";

const READ_PERMS = ["view_payment_control"];
const Z = new Prisma.Decimal(0);

// ייצוא-חוזר של טיפוסים בלבד (נמחקים בקומפילציה — מותר ב-"use server").
export type { CashCurrency, CashExpenseReason } from "./constants";

export type CashDayRow = {
  date: string; // YYYY-MM-DD
  receiptsIls: string;
  receiptsUsd: string;
  expensesIls: string;
  expensesUsd: string;
  expectedIls: string; // תנועת היום (קבלות − הוצאות)
  expectedUsd: string;
  receiptsCount: number; // מספר קליטות מזומן ביום
  deviations: number; // מספר חריגות אמצעי תשלום ביום
};

/** סטטוס קבלת אמצעי תשלום: ✅ במלואו · 🟠 חלקית · ❌ לא התקבל */
export type CashDeviationMethodStatus = "full" | "partial" | "none";

/** שורת אמצעי תשלום מתוכנן בהזמנה — מתוכנן מול בפועל */
export type CashDeviationMethodLine = {
  method: string;
  label: string;
  plannedUsd: string;
  actualUsd: string;
  remainingUsd: string;
  status: CashDeviationMethodStatus;
};

/** אמצעי תשלום שהוזן בפועל אך לא תוכנן בהזמנה (חריגה) */
export type CashDeviationExtraLine = {
  method: string;
  label: string;
  actualUsd: string;
};

export type CashMethodDeviationRow = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  /** תקציר טקסטואלי (תאימות לאחור / ייצוא) */
  plannedLabel: string;
  actualLabel: string;
  /** סה״כ הסכום שהתקבל באמצעים חורגים */
  amountUsd: string;
  plannedMethods: CashDeviationMethodLine[];
  extraMethods: CashDeviationExtraLine[];
  plannedTotalUsd: string; // סה״כ נדרש להזמנה
  actualTotalUsd: string; // סה״כ התקבל (כל האמצעים)
  remainingUsd: string; // סה״כ נותר לגבות
  deviationUsd: string; // סכום שהתקבל באמצעי לא מתוכנן
  status: "deviation" | "partial" | "full";
  dateKey: string | null; // יום החריגה (YYYY-MM-DD) — לשיוך לטבלת הבקרה
};

export type CashMethodDeviationTotals = {
  requiredUsd: string;
  receivedUsd: string;
  remainingUsd: string;
  deviationUsd: string;
};

export type {
  CashControlDeviationRow,
  CashControlDeviationType,
  CashControlDeviationStatus,
  CashControlDeviationMethodLine,
} from "@/lib/cash-control-deviations-shared";

export type CashMethodDeviationPayload = {
  rows: CashMethodDeviationRow[];
  count: number;
  totals: CashMethodDeviationTotals;
};

export type CashDashboard = {
  week: string;
  /** מספר חריגות אמצעי תשלום (planned != actual) בשבוע */
  methodDeviations: number;
  expectedIls: string;
  expectedUsd: string;
  countedIls: string | null;
  countedUsd: string | null;
  diffIls: string | null;
  diffUsd: string | null;
  receiptsIls: string;
  receiptsUsd: string;
  expensesIls: string;
  expensesUsd: string;
  days: CashDayRow[];
  lastCount: {
    id: string;
    countedAt: string;
    varianceStatus: "OPEN" | "APPROVED";
    varianceNote: string | null;
    notes: string | null;
    createdByName: string | null;
  } | null;
};

export type CashDetailRow = {
  id: string;
  kind: "RECEIPT" | "EXPENSE";
  date: string;
  docLabel: string | null; // מספר מסמך (קוד קליטה)
  customerId: string | null;
  customerName: string | null; // לקוח
  orderId: string | null; // הזמנה מקושרת
  orderNumber: string | null; // מספר הזמנה
  movementLabel: string; // סוג תנועה
  methodLabel: string | null; // סוג תשלום (לקליטות)
  methodBucket: PaymentBucketKey | null; // קבוצת אמצעי לצביעה
  reasonLabel: string | null; // סוג הוצאה (להוצאות)
  notes: string | null;
  userName: string | null; // משתמש שרשם
  amount: string; // חיובי לתקבול, שלילי להוצאה (במטבע המודל)
  amountUsd: string | null; // סכום בדולר (לקליטות)
  amountIls: string | null; // סכום בשקל (לקליטות)
  documents: { id: string; fileName: string }[]; // מסמכים מצורפים
};

export type CashDetailPayload = {
  currency: CashCurrency;
  rows: CashDetailRow[];
  receipts: string;
  expenses: string;
  total: string;
};

export type CashCountRow = {
  id: string;
  countedAt: string;
  expectedIls: string;
  countedIls: string;
  diffIls: string;
  expectedUsd: string;
  countedUsd: string;
  diffUsd: string;
  varianceStatus: "OPEN" | "APPROVED";
  varianceNote: string | null;
  notes: string | null;
  createdByName: string | null;
  approvedByName: string | null;
};

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function dec(v: number | string | null | undefined): Prisma.Decimal {
  if (v == null || v === "") return Z;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : Z;
  } catch {
    return Z;
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_REASONS.map((r) => [r.value, r.label]),
);

type DayBucket = {
  recIls: Prisma.Decimal;
  recUsd: Prisma.Decimal;
  expIls: Prisma.Decimal;
  expUsd: Prisma.Decimal;
  recIds: Set<string>;
};

/**
 * חישוב "אמור להיות" — זרם מזומן יחיד: קליטות מזומן (Payment עם שיטת CASH)
 * פחות הוצאות קופה (CashExpense), לפי שבוע ומטבע. כולל פירוט לפי יום.
 */
async function computeExpected(week: string): Promise<{
  expectedIls: Prisma.Decimal;
  expectedUsd: Prisma.Decimal;
  receiptsIls: Prisma.Decimal;
  receiptsUsd: Prisma.Decimal;
  expensesIls: Prisma.Decimal;
  expensesUsd: Prisma.Decimal;
  days: CashDayRow[];
}> {
  const [ilsReceipts, usdReceipts, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekCashPaymentsWhere(week, "ILS"),
      select: { id: true, amountIls: true, paymentDate: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: cashControlWeekCashPaymentsWhere(week, "USD"),
      select: { id: true, amountUsd: true, paymentDate: true, createdAt: true },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: week, status: "ACTIVE" },
      select: { currency: true, amount: true, expenseDate: true },
    }),
  ]);

  const buckets = new Map<string, DayBucket>();
  const bucket = (key: string): DayBucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z, recIds: new Set<string>() };
      buckets.set(key, b);
    }
    return b;
  };

  let receiptsIls = Z;
  let receiptsUsd = Z;
  let expensesIls = Z;
  let expensesUsd = Z;

  for (const p of ilsReceipts) {
    const amt = p.amountIls ?? Z;
    receiptsIls = receiptsIls.add(amt);
    const b = bucket(dayKey(p.paymentDate ?? p.createdAt));
    b.recIls = b.recIls.add(amt);
    b.recIds.add(p.id);
  }
  for (const p of usdReceipts) {
    const amt = p.amountUsd ?? Z;
    receiptsUsd = receiptsUsd.add(amt);
    const b = bucket(dayKey(p.paymentDate ?? p.createdAt));
    b.recUsd = b.recUsd.add(amt);
    b.recIds.add(p.id);
  }
  for (const e of expenses) {
    const amt = e.amount ?? Z;
    const b = bucket(dayKey(e.expenseDate));
    if (e.currency === "USD") {
      expensesUsd = expensesUsd.add(amt);
      b.expUsd = b.expUsd.add(amt);
    } else {
      expensesIls = expensesIls.add(amt);
      b.expIls = b.expIls.add(amt);
    }
  }

  // שלד של כל 7 ימי השבוע (גם ימים ללא תנועה) — כמו במערכת הישנה.
  const range = getAhWeekRange(week);
  const dateKeys: string[] = [];
  if (range) {
    for (let d = new Date(`${range.from}T00:00:00Z`); dayKey(d) <= range.to; d.setUTCDate(d.getUTCDate() + 1)) {
      dateKeys.push(dayKey(d));
    }
  }
  // הוספת ימים מתוך הנתונים שלא נכללו בטווח (קצה/אי-התאמת אזור-זמן).
  for (const k of buckets.keys()) {
    if (!dateKeys.includes(k)) dateKeys.push(k);
  }
  dateKeys.sort((a, b) => a.localeCompare(b));

  const emptyBucket: DayBucket = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z, recIds: new Set<string>() };
  const days: CashDayRow[] = dateKeys.map((date) => {
    const b = buckets.get(date) ?? emptyBucket;
    return {
      date,
      receiptsIls: money(b.recIls),
      receiptsUsd: money(b.recUsd),
      expensesIls: money(b.expIls),
      expensesUsd: money(b.expUsd),
      expectedIls: money(b.recIls.sub(b.expIls)),
      expectedUsd: money(b.recUsd.sub(b.expUsd)),
      receiptsCount: b.recIds.size,
      deviations: 0,
    };
  });

  return {
    expectedIls: receiptsIls.sub(expensesIls),
    expectedUsd: receiptsUsd.sub(expensesUsd),
    receiptsIls,
    receiptsUsd,
    expensesIls,
    expensesUsd,
    days,
  };
}

/** חריגות אמצעי תשלום — לפי שבוע ההזמנה (Order.weekCode), לא לפי שבוע הקליטה. */
async function computeMethodDeviations(wk: string): Promise<CashMethodDeviationRow[]> {
  return computeMethodDeviationsLegacy(wk.trim());
}

export async function listCashControlDeviationsAction(week: string) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) {
    return { rows: [], count: 0 };
  }
  const rows = await computeCashControlDeviations(week.trim());
  return { rows, count: rows.length };
}

export async function listMethodDeviationsAction(week: string): Promise<CashMethodDeviationPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) {
    return { rows: [], count: 0, totals: { requiredUsd: "0.00", receivedUsd: "0.00", remainingUsd: "0.00", deviationUsd: "0.00" } };
  }
  const rows = await computeMethodDeviations(week.trim());
  let required = 0;
  let received = 0;
  let remaining = 0;
  let deviation = 0;
  for (const r of rows) {
    required += Number(r.plannedTotalUsd);
    received += Number(r.actualTotalUsd);
    remaining += Number(r.remainingUsd);
    deviation += Number(r.deviationUsd);
  }
  const f = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return {
    rows,
    count: rows.length,
    totals: { requiredUsd: f(required), receivedUsd: f(received), remainingUsd: f(remaining), deviationUsd: f(deviation) },
  };
}

// === בקרת תשלומים (שבועי) — מסך בקרה: נדרש / התקבל / חסר / חריגה ===

export type PaymentsControlOrderStatus = "paid" | "partial" | "unpaid";

export type PaymentsControlOrderRow = {
  orderId: string;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  dateYmd: string;
  methodLabel: string; // אמצעי מתוכנן / אמצעי ההזמנה
  actualMethodLabel: string | null; // אמצעי בפועל (כשיש חריגה)
  /** סכום הזמנה מלא (ביקורת) */
  orderTotalUsd: string;
  /** יתרה פתוחה אמיתית */
  openBalanceUsd: string;
  /** שולם עד כה על ההזמנה */
  paidUsd: string;
  /** נקלט בשבוע זה על ההזמנה */
  weekReceivedUsd: string;
  /** עודף גבייה */
  surplusUsd: string;
  /** תאימות לאחור — שווה ל-openBalanceUsd */
  requiredUsd: string;
  /** תאימות לאחור — שווה ל-paidUsd */
  receivedUsd: string;
  /** תאימות לאחור — שווה ל-openBalanceUsd */
  missingUsd: string;
  deviationUsd: string;
  status: PaymentsControlOrderStatus;
  hasDeviation: boolean;
};

export type PaymentsControlReceiptRow = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  dateYmd: string;
  methodLabel: string;
  amountUsd: string;
};

export type { CashControlMethodSummaryPayload } from "@/lib/cash-control-method-summary";
export type { CashReconciliationSummaryPayload, CashReconciliationLineId } from "@/lib/cash-control-reconciliation";

export type PaymentsControlPayload = {
  week: string;
  totals: {
    requiredUsd: string;
    receivedUsd: string;
    missingUsd: string;
    deviationUsd: string;
  };
  orders: PaymentsControlOrderRow[];
  receipts: PaymentsControlReceiptRow[];
  methodSummary: CashControlMethodSummaryPayload;
  reconciliation: CashReconciliationSummaryPayload;
};

export async function getPaymentsControlAction(week: string): Promise<PaymentsControlPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();

  const [orders, deviations, allDeviations] = await Promise.all([
    prisma.order.findMany({
      where: { weekCode: wk, deletedAt: null, status: { not: "DEBT_WITHDRAWAL" } },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        customerId: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        paymentMethod: true,
        usdRateUsed: true,
        snapshotFinalDollarRate: true,
        exchangeRate: true,
        customer: { select: { displayName: true } },
        paymentBreakdown: { select: { paymentMethod: true, amount: true, currency: true } },
      },
    }),
    computeMethodDeviations(wk),
    computeCashControlDeviations(wk),
  ]);

  const orderIds = orders.map((o) => o.id);
  const receivedByOrder = new Map<string, number>();
  if (orderIds.length > 0) {
    const lifetimeSums = await groupByActivePayments(
      "orderId",
      { orderId: { in: orderIds }, amountUsd: { not: null } },
      { amountUsd: true },
    );
    for (const s of lifetimeSums) {
      if (!s.orderId) continue;
      receivedByOrder.set(s.orderId, Number(s._sum?.amountUsd?.toString() ?? 0) || 0);
    }
  }

  const devByOrder = new Map(deviations.map((d) => [d.orderId, d]));
  const orderHasDeviation = new Set(allDeviations.map((d) => d.orderId));

  let openBalanceTotal = 0;
  let deviationTotal = 0;
  const orderRows: PaymentsControlOrderRow[] = orders.map((o) => {
    const paid = receivedByOrder.get(o.id) ?? 0;
    const balance = computeCashControlOrderBalance(o, paid);
    const computed = toCashControlOrderComputed(balance, paid);
    openBalanceTotal += balance.openBalanceUsd;
    let status: PaymentsControlOrderStatus = "unpaid";
    if (balance.openBalanceUsd <= CASH_CONTROL_EPS) status = "paid";
    else if (balance.paidUsd > CASH_CONTROL_EPS) status = "partial";
    const methodLabel = isCompositePaymentMethod(o.paymentMethod)
      ? o.paymentBreakdown.map((b) => PAYMENT_METHOD_LABELS[b.paymentMethod] ?? b.paymentMethod).join(" · ") ||
        "תשלום מורכב"
      : o.paymentMethod
        ? PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod
        : "—";
    const dev = devByOrder.get(o.id);
    if (dev) deviationTotal += Number(dev.deviationUsd);
    return {
      orderId: o.id,
      orderNumber: o.orderNumber ?? null,
      customerId: o.customerId ?? null,
      customerName: o.customer?.displayName ?? null,
      dateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
      methodLabel,
      actualMethodLabel: dev ? dev.actualLabel || null : null,
      orderTotalUsd: computed.orderTotalUsd,
      openBalanceUsd: computed.openBalanceUsd,
      paidUsd: computed.paidUsd,
      weekReceivedUsd: computed.weekReceivedUsd,
      surplusUsd: computed.surplusUsd,
      requiredUsd: computed.requiredUsd,
      receivedUsd: computed.receivedUsd,
      missingUsd: computed.missingUsd,
      deviationUsd: dev ? fixCashUsd(Number(dev.deviationUsd)) : "0.00",
      status,
      hasDeviation: orderHasDeviation.has(o.id),
    };
  });

  const payRows = await prisma.payment.findMany({
    where: cashControlWeekPaymentsWhere(wk),
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      customer: { select: { displayName: true } },
      order: { select: { orderNumber: true } },
    },
  });
  const reconPayRows = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    select: {
      amountIls: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
      methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
    },
  });
  let receivedTotal = 0;
  const receiptRows: PaymentsControlReceiptRow[] = payRows.map((p) => {
    const amt = Number(p.amountUsd?.toString() ?? 0) || 0;
    receivedTotal += amt;
    const method = (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
    const dt = p.paymentDate ?? p.createdAt;
    return {
      paymentId: p.id,
      paymentCode: p.paymentCode ?? null,
      orderId: p.orderId ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      customerId: p.customerId ?? null,
      customerName: p.customer?.displayName ?? null,
      dateYmd: dt ? formatLocalYmd(new Date(dt)) : "—",
      methodLabel: method ? PAYMENT_METHOD_LABELS[method] ?? method : "—",
      amountUsd: fixCashUsd(amt),
    };
  });

  const methodSummary = buildCashControlMethodSummary(orders, payRows);
  const reconciliation = buildCashReconciliationSummary(reconPayRows);

  return {
    week: wk,
    totals: {
      requiredUsd: fixCashUsd(openBalanceTotal),
      receivedUsd: fixCashUsd(receivedTotal),
      missingUsd: fixCashUsd(openBalanceTotal),
      deviationUsd: fixCashUsd(deviationTotal),
    },
    orders: orderRows,
    receipts: receiptRows,
    methodSummary,
    reconciliation,
  };
}

export async function getCashDashboardAction(week: string): Promise<CashDashboard | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();

  const exp = await computeExpected(wk);
  const allDeviations = await computeCashControlDeviations(wk);
  const devByDay = new Map<string, number>();
  for (const d of allDeviations) {
    if (!d.intakeDateKey) continue;
    devByDay.set(d.intakeDateKey, (devByDay.get(d.intakeDateKey) ?? 0) + 1);
  }
  for (const day of exp.days) {
    day.deviations = devByDay.get(day.date) ?? 0;
  }
  const last = await prisma.cashCount.findFirst({
    where: { weekCode: wk },
    orderBy: { countedAt: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });

  const countedIls = last ? last.countedIls : null;
  const countedUsd = last ? last.countedUsd : null;

  return {
    week: wk,
    methodDeviations: allDeviations.length,
    expectedIls: money(exp.expectedIls),
    expectedUsd: money(exp.expectedUsd),
    countedIls: countedIls ? money(countedIls) : null,
    countedUsd: countedUsd ? money(countedUsd) : null,
    diffIls: countedIls ? money(countedIls.sub(exp.expectedIls)) : null,
    diffUsd: countedUsd ? money(countedUsd.sub(exp.expectedUsd)) : null,
    receiptsIls: money(exp.receiptsIls),
    receiptsUsd: money(exp.receiptsUsd),
    expensesIls: money(exp.expensesIls),
    expensesUsd: money(exp.expensesUsd),
    days: exp.days,
    lastCount: last
      ? {
          id: last.id,
          countedAt: last.countedAt.toISOString(),
          varianceStatus: last.varianceStatus === "APPROVED" ? "APPROVED" : "OPEN",
          varianceNote: last.varianceNote,
          notes: last.notes,
          createdByName: last.createdBy?.fullName ?? null,
        }
      : null,
  };
}

export async function listCashDetailAction(
  week: string,
  currency: CashCurrency,
  filterDay?: string,
): Promise<CashDetailPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) {
    return { currency, rows: [], receipts: "0.00", expenses: "0.00", total: "0.00" };
  }
  const wk = week.trim();
  const day = filterDay?.trim() || null;

  const payments = await prisma.payment.findMany({
    where: cashControlWeekCashPaymentsWhere(wk, currency),
    select: {
      id: true,
      paymentCode: true,
      paymentNumber: true,
      paymentDate: true,
      createdAt: true,
      amountIls: true,
      amountUsd: true,
      ilsPaymentMethod: true,
      usdPaymentMethod: true,
      paymentMethod: true,
      usdNote: true,
      ilsNote: true,
      notes: true,
      customerId: true,
      orderId: true,
      order: { select: { orderNumber: true } },
      customer: { select: { displayName: true, customerCode: true } },
      createdBy: { select: { fullName: true } },
    },
    orderBy: { paymentDate: "asc" },
  });

  // מסמכים מצורפים לכל קליטות התשלום בטווח — שאילתה אחת (ללא N+1)
  const docsByPayment = new Map<string, { id: string; fileName: string }[]>();
  if (payments.length > 0) {
    try {
      await ensureDocumentsTable();
      const docs = await prisma.document.findMany({
        where: {
          entityType: "PAYMENT",
          entityId: { in: payments.map((p) => p.id) },
          deletedAt: null,
        },
        select: { id: true, fileName: true, entityId: true },
        orderBy: { createdAt: "desc" },
      });
      for (const d of docs) {
        const arr = docsByPayment.get(d.entityId) ?? [];
        arr.push({ id: d.id, fileName: d.fileName });
        docsByPayment.set(d.entityId, arr);
      }
    } catch {
      /* טבלת מסמכים לא זמינה — ממשיכים ללא מסמכים */
    }
  }
  const expenses = await prisma.cashExpense.findMany({
    where: { weekCode: wk, status: "ACTIVE", currency },
    select: {
      id: true,
      expenseDate: true,
      amount: true,
      reason: true,
      notes: true,
      createdBy: { select: { fullName: true } },
    },
    orderBy: { expenseDate: "asc" },
  });

  const rows: CashDetailRow[] = [];
  let receipts = Z;
  for (const p of payments) {
    const when = p.paymentDate ?? p.createdAt;
    if (day && dayKey(when) !== day) continue;
    const amt = (currency === "ILS" ? p.amountIls : p.amountUsd) ?? Z;
    receipts = receipts.add(amt);
    const method = currency === "ILS" ? p.ilsPaymentMethod : p.usdPaymentMethod;
    const bucket = paymentMethodBucketKey(method ?? p.paymentMethod);
    const note = (currency === "ILS" ? p.ilsNote : p.usdNote) ?? p.notes ?? null;
    rows.push({
      id: p.id,
      kind: "RECEIPT",
      date: when.toISOString(),
      docLabel: p.paymentCode ?? (p.paymentNumber != null ? `#${p.paymentNumber}` : "—"),
      customerId: p.customerId ?? null,
      customerName:
        p.customer?.displayName ??
        (p.customer?.customerCode ? `קוד ${p.customer.customerCode}` : null),
      orderId: p.orderId ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      movementLabel: "קליטת תשלום",
      methodLabel: PAYMENT_BUCKET_LABELS[bucket],
      methodBucket: bucket,
      reasonLabel: null,
      notes: note,
      userName: p.createdBy?.fullName ?? null,
      amount: money(amt),
      amountUsd: money(p.amountUsd ?? Z),
      amountIls: money(p.amountIls ?? Z),
      documents: docsByPayment.get(p.id) ?? [],
    });
  }
  let expensesTotal = Z;
  for (const e of expenses) {
    if (day && dayKey(e.expenseDate) !== day) continue;
    const amt = e.amount ?? Z;
    expensesTotal = expensesTotal.add(amt);
    const reasonLabel = REASON_LABEL[e.reason] ?? "אחר";
    rows.push({
      id: e.id,
      kind: "EXPENSE",
      date: e.expenseDate.toISOString(),
      docLabel: null,
      customerId: null,
      customerName: null,
      orderId: null,
      orderNumber: null,
      movementLabel: `הוצאת קופה — ${reasonLabel}`,
      methodLabel: null,
      methodBucket: "OTHER",
      reasonLabel,
      notes: e.notes,
      userName: e.createdBy?.fullName ?? null,
      amount: money(amt.neg()),
      amountUsd: currency === "USD" ? money(amt.neg()) : null,
      amountIls: currency === "ILS" ? money(amt.neg()) : null,
      documents: [],
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  return {
    currency,
    rows,
    receipts: money(receipts),
    expenses: money(expensesTotal),
    total: money(receipts.sub(expensesTotal)),
  };
}

export async function saveCashExpenseAction(input: {
  week: string;
  currency: CashCurrency;
  amount: number | string;
  reason: CashExpenseReason;
  notes?: string;
  expenseDate?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false, error: "אין הרשאה" };

  const amount = dec(input.amount);
  if (amount.eq(0)) return { ok: false, error: "יש להזין סכום שונה מאפס" };

  await prisma.cashExpense.create({
    data: {
      weekCode: input.week.trim() || null,
      currency: input.currency === "USD" ? "USD" : "ILS",
      amount,
      reason: input.reason,
      notes: input.notes?.trim() || null,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
      createdById: me.id,
    },
  });

  revalidatePath("/admin/cash-control");
  return { ok: true };
}

export async function listCashExpensesAction(week: string): Promise<
  {
    id: string;
    expenseDate: string;
    currency: CashCurrency;
    amount: string;
    reasonLabel: string;
    notes: string | null;
    createdByName: string | null;
  }[]
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  const rows = await prisma.cashExpense.findMany({
    where: { weekCode: week.trim(), status: "ACTIVE" },
    orderBy: { expenseDate: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });
  return rows.map((e) => ({
    id: e.id,
    expenseDate: e.expenseDate.toISOString(),
    currency: e.currency === "USD" ? "USD" : "ILS",
    amount: money(e.amount ?? Z),
    reasonLabel: REASON_LABEL[e.reason] ?? "אחר",
    notes: e.notes,
    createdByName: e.createdBy?.fullName ?? null,
  }));
}

export async function cancelCashExpenseAction(id: string): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false };
  await prisma.cashExpense.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/admin/cash-control");
  return { ok: true };
}

export async function saveCashCountAction(input: {
  week: string;
  countedIls: number | string;
  countedUsd: number | string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false, error: "אין הרשאה" };

  const wk = input.week.trim();
  const exp = await computeExpected(wk);
  const countedIls = dec(input.countedIls);
  const countedUsd = dec(input.countedUsd);

  await prisma.cashCount.create({
    data: {
      weekCode: wk || null,
      expectedIls: exp.expectedIls,
      expectedUsd: exp.expectedUsd,
      countedIls,
      countedUsd,
      diffIls: countedIls.sub(exp.expectedIls),
      diffUsd: countedUsd.sub(exp.expectedUsd),
      notes: input.notes?.trim() || null,
      varianceStatus: "OPEN",
      createdById: me.id,
    },
  });

  revalidatePath("/admin/cash-control");
  return { ok: true };
}

export async function listCashCountsAction(week?: string): Promise<CashCountRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  const rows = await prisma.cashCount.findMany({
    where: week?.trim() ? { weekCode: week.trim() } : {},
    orderBy: { countedAt: "desc" },
    take: 50,
    include: {
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    countedAt: c.countedAt.toISOString(),
    expectedIls: money(c.expectedIls ?? Z),
    countedIls: money(c.countedIls ?? Z),
    diffIls: money(c.diffIls ?? Z),
    expectedUsd: money(c.expectedUsd ?? Z),
    countedUsd: money(c.countedUsd ?? Z),
    diffUsd: money(c.diffUsd ?? Z),
    varianceStatus: c.varianceStatus === "APPROVED" ? "APPROVED" : "OPEN",
    varianceNote: c.varianceNote,
    notes: c.notes,
    createdByName: c.createdBy?.fullName ?? null,
    approvedByName: c.approvedBy?.fullName ?? null,
  }));
}

export async function explainVarianceAction(
  countId: string,
  note: string,
): Promise<{ ok: boolean }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { ok: false };
  await prisma.cashCount.update({ where: { id: countId }, data: { varianceNote: note.trim() || null } });
  revalidatePath("/admin/cash-control");
  return { ok: true };
}

export async function approveVarianceAction(countId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "רק מנהל מערכת יכול לאשר פער" };
  await prisma.cashCount.update({
    where: { id: countId },
    data: { varianceStatus: "APPROVED", approvedById: me.id, approvedAt: new Date() },
  });
  revalidatePath("/admin/cash-control");
  return { ok: true };
}

const PAYMENT_DETAIL_PERMS = ["view_payment_control", "receive_payments", "view_reports"];

export type PaymentDetailLineView = {
  lineNo: number;
  usdAmount: string;
  ilsAmount: string;
  usdMethodLabel: string;
  ilsMethodLabel: string;
  usdNote: string;
  ilsNote: string;
};

export type PaymentDetailViewPayload = {
  paymentId: string;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string;
  recordedByName: string | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  status: PaymentEntryPayload["status"];
  cancelReason: string | null;
  dollarRate: string | null;
  commissionPercent: string;
  notes: string | null;
  lines: PaymentDetailLineView[];
  totalUsd: string;
  totalIls: string;
  documents: { id: string; fileName: string }[];
  createdByName: string | null;
  createdDateYmd: string;
  createdTimeHm: string;
  updatedDateYmd: string;
  updatedTimeHm: string;
  /** Payment אין updatedBy — null תמיד */
  updatedByName: string | null;
  wasUpdated: boolean;
};

function methodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

function fmtLineAmount(n: number | ""): string {
  if (n === "" || !Number.isFinite(Number(n)) || Number(n) <= 0) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mapPaymentDetailLines(lines: PaymentLine[]): PaymentDetailLineView[] {
  return lines.map((line, idx) => ({
    lineNo: idx + 1,
    usdAmount: fmtLineAmount(line.usdAmount),
    ilsAmount: fmtLineAmount(line.ilsAmount),
    usdMethodLabel: methodLabel(line.usdPaymentMethod),
    ilsMethodLabel: methodLabel(line.ilsPaymentMethod),
    usdNote: line.usdNote?.trim() || "—",
    ilsNote: line.ilsNote?.trim() || "—",
  }));
}

/** פירוט קליטת תשלום — תצוגה רחבה (קריאה בלבד) */
export async function getPaymentDetailViewAction(paymentId: string): Promise<PaymentDetailViewPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, PAYMENT_DETAIL_PERMS)) return null;

  const id = paymentId.trim();
  if (!id) return null;

  const entry = await loadPaymentEntryPayload(id);
  if (!entry) return null;

  const meta = await prisma.payment.findFirst({
    where: { id, customerId: { not: null } },
    select: {
      id: true,
      orderId: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      order: { select: { orderNumber: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!meta) return null;

  const documents: { id: string; fileName: string }[] = [];
  try {
    await ensureDocumentsTable();
    const docs = await prisma.document.findMany({
      where: { entityType: "PAYMENT", entityId: id, deletedAt: null },
      select: { id: true, fileName: true },
      orderBy: { createdAt: "desc" },
    });
    documents.push(...docs);
  } catch {
    /* טבלת מסמכים לא זמינה */
  }

  let totalUsd = 0;
  let totalIls = 0;
  for (const line of entry.lines) {
    const u = Number(line.usdAmount);
    const i = Number(line.ilsAmount);
    if (Number.isFinite(u) && u > 0) totalUsd += u;
    if (Number.isFinite(i) && i > 0) totalIls += i;
  }

  const createdAt = meta.createdAt;
  const updatedAt = meta.updatedAt;
  const wasUpdated = updatedAt.getTime() - createdAt.getTime() > 2000;

  return {
    paymentId: entry.id,
    paymentCode: entry.paymentCode,
    orderId: meta.orderId,
    orderNumber: meta.order?.orderNumber ?? null,
    customerName: entry.customer.displayName || entry.customer.customerCode || "—",
    recordedByName: meta.createdBy?.fullName ?? null,
    paymentDateYmd: entry.paymentDateYmd,
    paymentTimeHm: entry.paymentTimeHm,
    status: entry.status,
    cancelReason: entry.cancelReason,
    dollarRate: entry.dollarRate,
    commissionPercent: entry.commissionPercent,
    notes: meta.notes?.trim() || null,
    lines: mapPaymentDetailLines(entry.lines),
    totalUsd: totalUsd.toFixed(2),
    totalIls: totalIls.toFixed(2),
    documents,
    createdByName: meta.createdBy?.fullName ?? null,
    createdDateYmd: formatLocalYmd(createdAt),
    createdTimeHm: formatLocalHm(createdAt),
    updatedDateYmd: formatLocalYmd(updatedAt),
    updatedTimeHm: formatLocalHm(updatedAt),
    updatedByName: null,
    wasUpdated,
  };
}
