"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import { breakdownLineUsd, isCompositePaymentMethod } from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { formatLocalYmd } from "@/lib/work-week";
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
  expectedIls: string;
  expectedUsd: string;
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
};

export type CashMethodDeviationTotals = {
  requiredUsd: string;
  receivedUsd: string;
  remainingUsd: string;
  deviationUsd: string;
};

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
  movementLabel: string; // סוג תנועה
  methodLabel: string | null; // סוג תשלום (לקליטות)
  reasonLabel: string | null; // סוג הוצאה (להוצאות)
  notes: string | null;
  userName: string | null; // משתמש שרשם
  amount: string; // חיובי לתקבול, שלילי להוצאה
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
      where: { weekCode: week, status: "ACTIVE", ilsPaymentMethod: "CASH" },
      select: { amountIls: true, paymentDate: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: { weekCode: week, status: "ACTIVE", usdPaymentMethod: "CASH" },
      select: { amountUsd: true, paymentDate: true, createdAt: true },
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
      b = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z };
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
  }
  for (const p of usdReceipts) {
    const amt = p.amountUsd ?? Z;
    receiptsUsd = receiptsUsd.add(amt);
    const b = bucket(dayKey(p.paymentDate ?? p.createdAt));
    b.recUsd = b.recUsd.add(amt);
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

  const emptyBucket: DayBucket = { recIls: Z, recUsd: Z, expIls: Z, expUsd: Z };
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

/**
 * חריגות אמצעי תשלום לשבוע: הזמנות "תשלום מורכב" שבהן שולם בפועל
 * (Payment) באמצעי שלא תוכנן (OrderPaymentBreakdown). גזירה מנתוני האמת —
 * תאימות מלאה להזמנות ישנות (ללא חלוקה = ללא חריגה).
 */
async function computeMethodDeviations(wk: string): Promise<CashMethodDeviationRow[]> {
  const payments = await prisma.payment.findMany({
    where: { weekCode: wk, status: "ACTIVE", orderId: { not: null }, amountUsd: { not: null } },
    select: {
      orderId: true,
      amountUsd: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
    },
  });
  if (payments.length === 0) return [];

  const byOrder = new Map<string, Map<string, Prisma.Decimal>>();
  for (const p of payments) {
    if (!p.orderId) continue;
    const method = (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
    if (!method) continue;
    let m = byOrder.get(p.orderId);
    if (!m) {
      m = new Map<string, Prisma.Decimal>();
      byOrder.set(p.orderId, m);
    }
    m.set(method, (m.get(method) ?? Z).add(p.amountUsd ?? Z));
  }

  const orderIds = [...byOrder.keys()];
  if (orderIds.length === 0) return [];
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      paymentMethod: true,
      usdRateUsed: true,
      snapshotFinalDollarRate: true,
      exchangeRate: true,
      customer: { select: { displayName: true } },
      paymentBreakdown: { select: { paymentMethod: true, amount: true, currency: true } },
    },
  });

  const EPS = 0.02;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const fix = (n: number) => r2(Math.max(0, n)).toFixed(2);

  const rows: CashMethodDeviationRow[] = [];
  for (const o of orders) {
    if (!isCompositePaymentMethod(o.paymentMethod) || o.paymentBreakdown.length === 0) continue;
    const actual = byOrder.get(o.id);
    if (!actual) continue;

    const rateDec = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate ?? Z;
    const rateN = Number(rateDec.toString()) || 0;

    // מתוכנן לכל אמצעי (USD)
    const plannedByMethod = new Map<string, number>();
    for (const b of o.paymentBreakdown) {
      const usdVal =
        breakdownLineUsd(
          { amount: b.amount.toString(), currency: b.currency === "ILS" ? "ILS" : "USD" },
          rateN,
        ) ?? 0;
      plannedByMethod.set(b.paymentMethod, (plannedByMethod.get(b.paymentMethod) ?? 0) + usdVal);
    }

    // בפועל לכל אמצעי (USD)
    const actualByMethod = new Map<string, number>();
    for (const [method, amt] of actual) {
      if (isCompositePaymentMethod(method)) continue;
      actualByMethod.set(method, (actualByMethod.get(method) ?? 0) + Number(amt.toString()));
    }

    // חריגות: אמצעי שהתקבל אך לא תוכנן
    const extraMethods: CashDeviationExtraLine[] = [];
    let deviationUsd = 0;
    for (const [method, amt] of actualByMethod) {
      if (!plannedByMethod.has(method) && amt > EPS) {
        extraMethods.push({ method, label: PAYMENT_METHOD_LABELS[method] ?? method, actualUsd: fix(amt) });
        deviationUsd += amt;
      }
    }
    if (extraMethods.length === 0) continue; // המסך מציג רק חריגות אמיתיות

    // שורות מתוכנן מול בפועל לכל אמצעי שתוכנן
    const plannedMethods: CashDeviationMethodLine[] = [];
    let plannedTotal = 0;
    for (const [method, planned] of plannedByMethod) {
      const got = actualByMethod.get(method) ?? 0;
      let status: CashDeviationMethodStatus = "none";
      if (got >= planned - EPS && planned > EPS) status = "full";
      else if (got > EPS) status = "partial";
      plannedMethods.push({
        method,
        label: PAYMENT_METHOD_LABELS[method] ?? method,
        plannedUsd: fix(planned),
        actualUsd: fix(got),
        remainingUsd: fix(planned - got),
        status,
      });
      plannedTotal += planned;
    }

    let actualTotal = 0;
    for (const amt of actualByMethod.values()) actualTotal += amt;

    const remaining = Math.max(0, plannedTotal - actualTotal);
    rows.push({
      orderId: o.id,
      orderNumber: o.orderNumber ?? null,
      customerId: o.customerId ?? null,
      customerName: o.customer?.displayName ?? null,
      plannedLabel: [...plannedByMethod.keys()].map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(" · "),
      actualLabel: extraMethods.map((e) => e.label).join(" · "),
      amountUsd: fix(deviationUsd),
      plannedMethods,
      extraMethods,
      plannedTotalUsd: fix(plannedTotal),
      actualTotalUsd: fix(actualTotal),
      remainingUsd: fix(remaining),
      deviationUsd: fix(deviationUsd),
      status: remaining > EPS ? "partial" : "deviation",
    });
  }
  rows.sort((a, b) => (a.orderNumber ?? "").localeCompare(b.orderNumber ?? ""));
  return rows;
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
  requiredUsd: string;
  receivedUsd: string;
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
};

export async function getPaymentsControlAction(week: string): Promise<PaymentsControlPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();

  const [orders, deviations] = await Promise.all([
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
        paymentMethod: true,
        customer: { select: { displayName: true } },
        paymentBreakdown: { select: { paymentMethod: true } },
      },
    }),
    computeMethodDeviations(wk),
  ]);

  const orderIds = orders.map((o) => o.id);
  const receivedByOrder = new Map<string, number>();
  if (orderIds.length > 0) {
    const sums = await prisma.payment.findMany({
      where: { orderId: { in: orderIds }, status: "ACTIVE", amountUsd: { not: null } },
      select: { orderId: true, amountUsd: true },
    });
    for (const s of sums) {
      if (!s.orderId) continue;
      receivedByOrder.set(s.orderId, (receivedByOrder.get(s.orderId) ?? 0) + Number(s.amountUsd?.toString() ?? 0));
    }
  }

  const devByOrder = new Map(deviations.map((d) => [d.orderId, d]));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const fix = (n: number) => r2(Math.max(0, n)).toFixed(2);

  let requiredTotal = 0;
  let missingTotal = 0;
  let deviationTotal = 0;
  const orderRows: PaymentsControlOrderRow[] = orders.map((o) => {
    const required = Number((o.totalUsd ?? o.amountUsd ?? Z).toString()) || 0;
    const received = receivedByOrder.get(o.id) ?? 0;
    const missing = Math.max(0, required - received);
    requiredTotal += required;
    missingTotal += missing;
    let status: PaymentsControlOrderStatus = "unpaid";
    if (missing <= 0.02) status = "paid";
    else if (received > 0.02) status = "partial";
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
      requiredUsd: fix(required),
      receivedUsd: fix(received),
      missingUsd: fix(missing),
      deviationUsd: dev ? fix(Number(dev.deviationUsd)) : "0.00",
      status,
      hasDeviation: Boolean(dev),
    };
  });

  const payRows = await prisma.payment.findMany({
    where: { weekCode: wk, status: "ACTIVE", amountUsd: { not: null } },
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
      amountUsd: fix(amt),
    };
  });

  return {
    week: wk,
    totals: {
      requiredUsd: fix(requiredTotal),
      receivedUsd: fix(receivedTotal),
      missingUsd: fix(missingTotal),
      deviationUsd: fix(deviationTotal),
    },
    orders: orderRows,
    receipts: receiptRows,
  };
}

export async function getCashDashboardAction(week: string): Promise<CashDashboard | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();

  const exp = await computeExpected(wk);
  const deviations = await computeMethodDeviations(wk);
  const last = await prisma.cashCount.findFirst({
    where: { weekCode: wk },
    orderBy: { countedAt: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });

  const countedIls = last ? last.countedIls : null;
  const countedUsd = last ? last.countedUsd : null;

  return {
    week: wk,
    methodDeviations: deviations.length,
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

  const methodField = currency === "ILS" ? "ilsPaymentMethod" : "usdPaymentMethod";
  const payments = await prisma.payment.findMany({
    where: { weekCode: wk, status: "ACTIVE", [methodField]: "CASH" },
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
      customerId: true,
      customer: { select: { displayName: true, customerCode: true } },
      createdBy: { select: { fullName: true } },
    },
    orderBy: { paymentDate: "asc" },
  });
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
    rows.push({
      id: p.id,
      kind: "RECEIPT",
      date: when.toISOString(),
      docLabel: p.paymentCode ?? (p.paymentNumber != null ? `#${p.paymentNumber}` : "—"),
      customerId: p.customerId ?? null,
      customerName:
        p.customer?.displayName ??
        (p.customer?.customerCode ? `קוד ${p.customer.customerCode}` : null),
      movementLabel: "קליטת תשלום",
      methodLabel: method === "CASH" ? "מזומן" : method === "OTHER" ? "אחר" : method || "מזומן",
      reasonLabel: null,
      notes: null,
      userName: p.createdBy?.fullName ?? null,
      amount: money(amt),
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
      movementLabel: `הוצאת קופה — ${reasonLabel}`,
      methodLabel: null,
      reasonLabel,
      notes: e.notes,
      userName: e.createdBy?.fullName ?? null,
      amount: money(amt.neg()),
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
  if (amount.lte(0)) return { ok: false, error: "יש להזין סכום חיובי" };

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
