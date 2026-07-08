"use server";

import { PaymentMethod, Prisma } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import { revalidatePath } from "next/cache";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { scheduleRevalidateAfterPaymentSave } from "@/lib/revalidate-after-payment-save";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { assertCreatedByUserExists, SessionUserInvalidError } from "@/lib/session-user-guard";
import { computeFromUsdAmount } from "@/lib/financial-calc";
import { loadFinanceSettingsSerialized } from "@/lib/financial-settings";
import { logFinanceSaveTarget } from "@/lib/finance-log";
import { logPaymentAllocationPreSave } from "@/lib/payment-allocation-debug";
import { allocatePaymentAcrossOrders, roundMoney2, toPaymentIntakeBases } from "@/lib/payment-intake";
import {
  computePaymentOveragePreview,
  orderExpectedIlsValue,
  orderUsdTotal,
  paymentIlsValue,
  paymentUsdValue,
  sumOpenDebtIlsFromOrders,
} from "@/lib/customer-balance";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture, resolvePaymentWorkCountry } from "@/lib/payment-capture-code";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import {
  calculatePaymentLine,
  calculateTotals,
  normalizePaymentLine,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import {
  isCompositePaymentMethod,
  breakdownViolationMessage,
  PAYMENT_BUCKET_LABELS,
  type EnteredBucketUsd,
} from "@/lib/payment-breakdown-shared";
import {
  checkIntakeBreakdownViolations,
  METHOD_DEV_APPROVED_NOTE_TAG,
} from "@/lib/cash-control-intake-breakdown";
import { aggregateLivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { VAT_RATE } from "@/lib/vat";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { getCustomerInternalBalanceUsd } from "@/lib/customer-open-debt";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { recordActivityAudit } from "@/lib/activity-audit";
import {
  activePaidPaymentWhere,
  ensurePaymentRecordStatusColumns,
  PAYMENT_RECORD_STATUS_ACTIVE,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status";
import {
  BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
  BALANCE_RESET_LEDGER_LABEL,
  COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
  PAYMENT_SMALL_OVERAGE_COMMISSION_ABSORPTION_LABEL,
  PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL,
  planCommissionDebtClosure,
  planCommissionSurplusAbsorption,
  planBalanceResetToZero,
} from "@/lib/commission-debt-closure";

type FlatCheckInsert = { checkNumber: string; dueDate: Date; amount: Prisma.Decimal };

async function persistCustomerBalanceSnapshot(customerId: string, balanceUsd: Prisma.Decimal): Promise<void> {
  await ensureOnce("customer-balance-usd-column", async () => {
    await prisma.$executeRaw`
      ALTER TABLE "Customer"
      ADD COLUMN IF NOT EXISTS "balanceUsd" DECIMAL(19,4) NOT NULL DEFAULT 0
    `;
  });
  await prisma.$executeRaw`
    UPDATE "Customer"
    SET "balanceUsd" = ${balanceUsd}
    WHERE "id" = ${customerId}
  `;
}

function pushChecks(out: FlatCheckInsert[], checks: PaymentLine["usdChecks"]) {
  for (const c of checks ?? []) {
    const ymd = (c.dueDateYmd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const n = typeof c.amount === "number" && Number.isFinite(c.amount) ? c.amount : 0;
    if (n <= 0) continue;
    out.push({
      checkNumber: String(c.checkNumber ?? "").trim(),
      dueDate: parseLocalDate(ymd),
      amount: new Prisma.Decimal(String(n)).toDecimalPlaces(4, 4),
    });
  }
}

function flattenChecksFromPayments(payments: PaymentLine[]): FlatCheckInsert[] {
  const out: FlatCheckInsert[] = [];
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    if (p.usdPaymentMethod === "CHECK") pushChecks(out, p.usdChecks);
    if (p.ilsPaymentMethod === "CHECK") pushChecks(out, p.ilsChecks);
    if (p.paymentMethod === "CHECK") pushChecks(out, p.checks);
  }
  return out;
}

function mapMethodToPrismaFromLine(method: PaymentLineMethod): PaymentMethod {
  if (method === "CREDIT") return PaymentMethod.CREDIT;
  if (method === "BANK_TRANSFER") return PaymentMethod.BANK_TRANSFER;
  if (method === "CASH") return PaymentMethod.CASH;
  if (method === "CHECK") return PaymentMethod.CHECK;
  return PaymentMethod.OTHER;
}

function summarizeDualMethods(payments: PaymentLine[]): {
  usdMethod: PaymentMethod | null;
  ilsMethod: PaymentMethod | null;
  primaryMethod: PaymentMethod;
} {
  const usdMethods = new Set<PaymentMethod>();
  const ilsMethods = new Set<PaymentMethod>();
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    const calc = calculatePaymentLine(p, 1, VAT_RATE);
    if (calc.usd.hasAmount) usdMethods.add(mapMethodToPrismaFromLine(p.usdPaymentMethod));
    if (calc.finalIls > 0) ilsMethods.add(mapMethodToPrismaFromLine(p.ilsPaymentMethod));
  }
  const usdMethod = usdMethods.size === 1 ? [...usdMethods][0]! : usdMethods.size > 1 ? PaymentMethod.OTHER : null;
  const ilsMethod = ilsMethods.size === 1 ? [...ilsMethods][0]! : ilsMethods.size > 1 ? PaymentMethod.OTHER : null;
  const all = new Set([...usdMethods, ...ilsMethods]);
  const primaryMethod =
    all.size === 1 ? [...all][0]! : all.size === 0 ? PaymentMethod.CASH : PaymentMethod.OTHER;
  return { usdMethod, ilsMethod, primaryMethod };
}

function collectLineNotes(payments: PaymentLine[]): string | null {
  const notes: string[] = [];
  for (const raw of payments) {
    const p = normalizePaymentLine(raw);
    const t = (p.note ?? p.usdNote ?? p.ilsNote ?? "").trim();
    if (t) notes.push(t);
  }
  return notes.length ? notes.join(" · ") : null;
}

async function applyPaymentCustomerDraftsIfNeeded(params: {
  customerId: string;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
}): Promise<void> {
  const current = await prisma.customer.findFirst({
    where: { id: params.customerId, deletedAt: null, isActive: true },
    select: { nameAr: true, nameEn: true, phone: true, phone2: true },
  });
  if (!current) return;

  const nameAr = params.draftNameAr?.trim() || "";
  const nameEn = params.draftNameEn?.trim() || "";
  const phone = params.draftPhone?.trim() || "";

  const data: Prisma.CustomerUpdateInput = {};
  if (nameAr && !(current.nameAr?.trim())) data.nameAr = nameAr;
  if (nameEn && !(current.nameEn?.trim())) data.nameEn = nameEn;
  if (phone && !(current.phone?.trim()) && !(current.phone2?.trim())) data.phone = phone;
  if (Object.keys(data).length === 0) return;

  await prisma.customer.update({
    where: { id: params.customerId },
    data,
  });
}

export type PaymentUpdatedSaveInput = {
  customerId: string;
  receivedToday: boolean;
  paymentDateYmd: string;
  paymentTimeHm: string;
  weekCode: string | null;
  dollarRate: string;
  /**
   * אחוז עמלה כללי שנבחר בקליטה (תיעודי בלבד — לא משנה הקצאת חוב/יתרה).
   * שדה אופציונלי; ערך לא תקין → 0.
   */
  commissionPercent?: string | null;
  payments: PaymentLine[];
  includedOrderIds: string[] | null;
  /** Preview only in UI; applied only when saving payment */
  commissionResetOrderIds?: string[] | null;
  /** תצוגת "איפוס יתרה" — מיושם ב-DB רק בשמירת תשלום (באותה transaction) */
  applyCustomerBalanceReset?: boolean;
  /** איפוס יתרה מתוך יתרת זכות קיימת — במקום התאמת עמלה */
  applyCustomerBalanceResetFromCredit?: boolean;
  draftNameAr?: string | null;
  draftNameEn?: string | null;
  draftPhone?: string | null;
  /** כאשר true — עודף מעל החוב הפתוח נשמר כתשלום כללי (יתרת זכות) */
  saveSurplusAsCredit?: boolean;
  /** עודף תשלום — credit = יתרת זכות; commission = הוספה לעמלה */
  surplusDisposition?: "credit" | "commission" | null;
  /** מדינת קליטה מהמסך — מקצה TR-P / CN-P / AE-P נפרד */
  workCountry?: string | null;
  /** כאשר true — מאפשר שמירה למרות חריגת אמצעי תשלום (אישור מנהל) */
  allowMethodDeviation?: boolean;
};

const ALLOC_EPS = 0.02;

async function loadOrdersForPaymentAllocation(
  customerId: string,
  weekCode: string | null,
  workCountryRaw?: string | null,
): Promise<
  Array<{
    id: string;
    totalUsd: Prisma.Decimal | null;
    amountUsd: Prisma.Decimal | null;
    commissionUsd: Prisma.Decimal | null;
    totalIlsWithVat: Prisma.Decimal | null;
    totalIls: Prisma.Decimal | null;
    paidUsd: Prisma.Decimal;
    paidIls: Prisma.Decimal;
  }>
> {
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const wc = normalizeWorkCountryCode(workCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const orders = await prisma.order.findMany({
    where: {
      customerId,
      deletedAt: null,
      countryCode: wc,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      totalIlsWithVat: true,
      totalIls: true,
    },
  });
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, { usd: Prisma.Decimal; ils: Prisma.Decimal }>();
  if (orderIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds }, ...activePaidPaymentWhere },
      select: {
        orderId: true,
        amountUsd: true,
        totalIlsWithVat: true,
        amountIls: true,
        exchangeRate: true,
      },
    });
    for (const p of payments) {
      if (!p.orderId) continue;
      const cur = paidByOrder.get(p.orderId) ?? { usd: new Prisma.Decimal(0), ils: new Prisma.Decimal(0) };
      cur.usd = cur.usd.add(paymentUsdValue(p));
      cur.ils = cur.ils.add(paymentIlsValue(p));
      paidByOrder.set(p.orderId, cur);
    }
  }
  return orders.map((o) => {
    const paid = paidByOrder.get(o.id) ?? { usd: new Prisma.Decimal(0), ils: new Prisma.Decimal(0) };
    return { ...o, paidUsd: paid.usd, paidIls: paid.ils };
  });
}

export async function previewCustomerPaymentOverageAction(input: {
  customerId: string;
  totalPaymentUsd: number;
  dollarRate: string;
  weekCode?: string | null;
  workCountry?: string | null;
}): Promise<{ ok: true; preview: PaymentOveragePreview } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return { ok: false, error: "אין הרשאה" };

  const cid = input.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  let rateN = Number(String(input.dollarRate).trim().replace(",", "."));
  if (!Number.isFinite(rateN) || rateN <= 0) return { ok: false, error: "שער דולר לא תקין" };

  const paymentUsd = roundMoney2(input.totalPaymentUsd);
  if (paymentUsd <= 0) return { ok: false, error: "סכום תשלום לא תקין" };

  const orders = await loadOrdersForPaymentAllocation(
    cid,
    input.weekCode?.trim() || null,
    input.workCountry,
  );
  const openDebtIls = sumOpenDebtIlsFromOrders(
    orders.map((o) => ({
      totalIlsWithVat: o.totalIlsWithVat,
      totalIls: o.totalIls,
      paidIls: o.paidIls,
    })),
  );
  let openDebtUsd = 0;
  for (const o of orders) {
    const total = Number(orderUsdTotal(o).toFixed(4));
    const paid = Number(o.paidUsd.toFixed(4));
    openDebtUsd += Math.max(0, total - paid);
  }
  openDebtUsd = roundMoney2(openDebtUsd);

  const paymentIls = roundMoney2(paymentUsd * rateN);
  const preview = computePaymentOveragePreview({
    openDebtIls,
    openDebtUsd,
    paymentIls,
    paymentUsd,
  });

  return { ok: true, preview };
}

/**
 * אכיפת "תשלום מורכב" בצד שרת — בודק שהמתוכנן (OrderPaymentBreakdown) נשמר:
 * אסור לשלם באמצעי שלא הוגדר בהזמנה, ואסור לחרוג מהסכום שהוגדר לכל אמצעי.
 * מחזיר טקסט שגיאה (לחסימת שמירה) או null אם תקין.
 */
async function validateCompositeBreakdownEnforcement(params: {
  customerId: string;
  weekCode: string | null | undefined;
  workCountry: string | null | undefined;
  payments: PaymentLine[];
  rateN: number;
  includedOrderIds: string[] | null | undefined;
}): Promise<string | null> {
  const ordersRes = await loadPaymentIntakeOrdersForCustomer({
    customerId: params.customerId,
    weekCodeForOpenBalances: params.weekCode ?? null,
    paymentWorkCountryRaw: params.workCountry ?? null,
  });
  if (!ordersRes.ok) return null;

  const kpis = aggregateLivePaymentFormKpis(params.payments, params.rateN);
  const entered: EnteredBucketUsd[] = [
    { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: kpis.cash.totalUsd },
    { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: kpis.bankTransfer.totalUsd },
    { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, enteredUsd: kpis.credit.totalUsd },
    { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, enteredUsd: kpis.checks.totalUsd },
    { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, enteredUsd: kpis.other.totalUsd },
  ];

  const violations = checkIntakeBreakdownViolations(
    ordersRes.orders,
    params.includedOrderIds ?? null,
    entered,
    kpis.totalPaymentUsd,
  );
  if (violations.length === 0) return null;
  return `לא ניתן לשמור.\n\n${violations.map(breakdownViolationMessage).join("\n\n")}`;
}

export async function savePaymentUpdatedAction(
  form: PaymentUpdatedSaveInput,
): Promise<
  | {
      ok: true;
      saved: {
        primaryPaymentCode: string | null;
        primaryPaymentId: string | null;
        count: number;
        customerBalanceUsd: string;
      };
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return { ok: false, error: "אין הרשאה" };
  try {
    await assertCreatedByUserExists(me.id);
  } catch (e) {
    if (e instanceof SessionUserInvalidError) return { ok: false, error: "User Session Invalid" };
    throw e;
  }

  const cid = form.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const custOk = await prisma.customer.findFirst({
    where: { id: cid, deletedAt: null, isActive: true },
    select: { id: true, displayName: true },
  });
  if (!custOk) return { ok: false, error: "לקוח לא נמצא" };

  await applyPaymentCustomerDraftsIfNeeded({
    customerId: cid,
    draftNameAr: form.draftNameAr,
    draftNameEn: form.draftNameEn,
    draftPhone: form.draftPhone,
  });

  const fin = await loadFinanceSettingsSerialized("payment-capture");
  const base = new Prisma.Decimal(fin.baseDollarRate);
  const fee = new Prisma.Decimal(fin.dollarFee);

  let rateN = 0;
  try {
    rateN = Number(form.dollarRate.trim().replace(",", "."));
  } catch {
    return { ok: false, error: "שער דולר לא תקין" };
  }
  if (!Number.isFinite(rateN) || rateN <= 0) return { ok: false, error: "שער דולר חייב להיות חיובי" };

  const totals = calculateTotals(form.payments ?? [], rateN, VAT_RATE);
  if (totals.totalUsd <= ALLOC_EPS) {
    return { ok: false, error: "יש להוסיף סכום בדולר ו/או בשקל (נדרש שער דולר להמרת שקל)" };
  }
  console.log("[payment.save]", {
    customerId: cid,
    exchangeRate: rateN,
    commissionPercent: String(form.commissionPercent ?? ""),
  });

  const checkValidationErr = validatePaymentCheckLines(form.payments ?? []);
  if (checkValidationErr) return { ok: false, error: checkValidationErr };

  // בקרת "תשלום מורכב" — אכיפה בצד שרת (ניתן לעקוף באישור מנהל מפורש)
  if (!form.allowMethodDeviation) {
    const breakdownErr = await validateCompositeBreakdownEnforcement({
      customerId: cid,
      weekCode: form.weekCode,
      workCountry: form.workCountry,
      payments: form.payments ?? [],
      rateN,
      includedOrderIds: form.includedOrderIds,
    });
    if (breakdownErr) return { ok: false, error: breakdownErr };
  }

  const flatChecksForPrimary = flattenChecksFromPayments(form.payments ?? []);

  const today = new Date();
  const todayYmd = formatLocalYmd(today);
  const hm = (form.paymentTimeHm ?? "").trim();

  let paymentDate: Date;
  if (form.receivedToday) {
    paymentDate = hm ? parseLocalDateTime(todayYmd, hm) : today;
  } else {
    const d = form.paymentDateYmd.trim();
    if (!d) return { ok: false, error: "יש לבחור תאריך תשלום" };
    paymentDate = hm ? parseLocalDateTime(d, hm) : parseLocalDate(d);
  }

  const manualDateChanged =
    paymentDate.getFullYear() !== today.getFullYear() ||
    paymentDate.getMonth() !== today.getMonth() ||
    paymentDate.getDate() !== today.getDate();

  const weekCode = (form.weekCode?.trim() || getWeekCodeForLocalDate(paymentDate)).trim() || null;

  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const existingCustomerBalanceUsd = await getCustomerInternalBalanceUsd(cid);
  const forceCreditPayment = existingCustomerBalanceUsd.gt(new Prisma.Decimal("0.01"));

  // Load orders for allocations (same engine as intake + אותו חלון שבוע AH כמו במסך)
  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      status: { not: OS.DEBT_WITHDRAWAL },
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, orderNumber: true, totalUsd: true, amountUsd: true, commissionUsd: true },
  });
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  if (orderIds.length > 0) {
    const sums = await prisma.payment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
      _sum: { amountUsd: true },
    });
    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
  }

  const bases = toPaymentIntakeBases(
    orders.map((o) => {
      const deal = o.amountUsd ?? new Prisma.Decimal(0);
      const com = o.commissionUsd ?? new Prisma.Decimal(0);
      const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
      const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
      const remDec = totalUsdVal.sub(paidSum).toDecimalPlaces(2, 4);
      return {
        id: o.id,
        orderNumber: null,
        paymentCode: null,
        dateYmd: "—",
        week: null,
        rate: "—",
        amountUsd: deal.toFixed(2),
        commissionUsd: com.toFixed(2),
        totalIls: "0.00",
        totalAmountUsd: totalUsdVal.toFixed(2),
        dbPaidUsd: paidSum.toFixed(2),
        dbRemainingUsd: remDec.toFixed(2),
        status: "unpaid" as const,
        lastPaymentDateYmd: null,
        sourceCountry: null,
        isComposite: false,
        breakdown: [],
        actualMethods: [],
        hasMethodDeviation: false,
      };
    }),
  );

  const prioritized =
    forceCreditPayment
      ? new Set<string>()
      : form.includedOrderIds === null
        ? null
        : new Set((form.includedOrderIds ?? []).filter(Boolean));

  const totalIlsEntered = totals.totalIls;
  const totalIlsDec =
    totalIlsEntered > 0 ? new Prisma.Decimal(totalIlsEntered.toFixed(4)) : null;

  let allocationEntries: [string, number][] = [];
  let unallocatedUsd = 0;
  let surplusCommissionAbsorbedUsd = 0;
  let surplusCommissionOrderId: string | null = null;
  const surplusAsCredit =
    form.saveSurplusAsCredit || forceCreditPayment || form.surplusDisposition === "credit";
  const surplusToCommission = form.surplusDisposition === "commission";
  if (totals.totalUsd > ALLOC_EPS) {
    if (forceCreditPayment) {
      unallocatedUsd = totals.totalUsd;
      allocationEntries = [];
      logPaymentAllocationPreSave({
        source: "payment-save-server",
        customerId: cid,
        customerLoaded: true,
        ordersCount: orders.length,
        paymentAmountUsd: totals.totalUsd,
        selectedOrderIds: form.includedOrderIds ?? null,
        weekCode: weekCode,
        bases,
        prioritizedOrderIds: prioritized,
        forceCustomerCreditPayment: true,
      });
    } else {
      const allocDiag = logPaymentAllocationPreSave({
        source: "payment-save-server",
        customerId: cid,
        customerLoaded: true,
        ordersCount: orders.length,
        paymentAmountUsd: totals.totalUsd,
        selectedOrderIds: form.includedOrderIds ?? null,
        weekCode: weekCode,
        bases,
        prioritizedOrderIds: prioritized,
        forceCustomerCreditPayment: false,
      });
      unallocatedUsd = allocDiag.unallocatedUsd;
      allocationEntries = allocDiag.allocationTargets.map((t) => [t.orderId, t.amountUsd] as [string, number]);
    }
    if (allocationEntries.length === 0 && !(surplusAsCredit && unallocatedUsd > ALLOC_EPS)) {
      return { ok: false, error: "אין יעד להקצאה לסכום הדולר" };
    }
    if (
      unallocatedUsd > ALLOC_EPS &&
      !surplusAsCredit &&
      !surplusToCommission &&
      !form.applyCustomerBalanceReset &&
      !form.applyCustomerBalanceResetFromCredit
    ) {
      return {
        ok: false,
        error: `התשלום גבוה מהחוב ב-$${unallocatedUsd.toFixed(2)} — בחרו «שמור כיתרת זכות» או «הוסף לעמלות»`,
      };
    }

    if (surplusToCommission && unallocatedUsd > ALLOC_EPS && allocationEntries.length > 0) {
      surplusCommissionAbsorbedUsd = roundMoney2(unallocatedUsd);
      const lastIdx = allocationEntries.length - 1;
      const [orderId, allocUsd] = allocationEntries[lastIdx];
      allocationEntries[lastIdx] = [orderId, roundMoney2(allocUsd + surplusCommissionAbsorbedUsd)];
      surplusCommissionOrderId = orderId;
      unallocatedUsd = 0;
    } else if (
      form.applyCustomerBalanceReset &&
      !form.applyCustomerBalanceResetFromCredit &&
      unallocatedUsd > ALLOC_EPS &&
      allocationEntries.length > 0
    ) {
      const lastIdx = allocationEntries.length - 1;
      const [orderId, allocUsd] = allocationEntries[lastIdx];
      allocationEntries[lastIdx] = [orderId, roundMoney2(allocUsd + unallocatedUsd)];
      unallocatedUsd = 0;
    }
  } else {
    return { ok: false, error: "אין יעד להקצאה" };
  }

  const { usdMethod, ilsMethod, primaryMethod: payMethodDb } = summarizeDualMethods(form.payments ?? []);
  const lineNotes = collectLineNotes(form.payments ?? []);

  const finalUse = new Prisma.Decimal(String(rateN)).toDecimalPlaces(6, 4);
  const finalGlobal = new Prisma.Decimal(fin.finalDollarRate);
  logFinanceSaveTarget("payment-updated-save", "Payment", {
    rateFromForm: finalUse.toString(),
    globalFinal: finalGlobal.toString(),
  });
  const vatRate = prismaVatRatePercent();

  /**
   * "אחוז עמלה" — תוספת חדשה. תיעוד ברגע הקליטה: 0..100 (Decimal(7,4)).
   * ערך לא תקין/מחוץ לטווח → 0. אינו משפיע על amountUsd / יתרה / הקצאה.
   */
  let commissionPctDec = new Prisma.Decimal(0);
  if (form.commissionPercent != null) {
    const raw = String(form.commissionPercent).trim().replace(",", ".");
    if (raw !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        commissionPctDec = new Prisma.Decimal(n.toString()).toDecimalPlaces(4, 4);
      }
    }
  }

  const breakdownLines = form.payments.map((p, i) => {
    const n = normalizePaymentLine(p);
    const c = calculatePaymentLine(n, rateN, VAT_RATE);
    const parts: string[] = [`#${i + 1}`];
    const method = n.paymentMethod ?? n.usdPaymentMethod ?? n.ilsPaymentMethod ?? "CASH";
    if (c.usd.hasAmount) {
      parts.push(
        `USD $${c.usd.finalAmount.toFixed(2)} · ${method}`,
        `usdBase=$${c.usd.baseAmount.toFixed(2)} usdVat=$${c.usd.vatAmount.toFixed(2)}`,
      );
    }
    if (c.finalIls > 0) {
      parts.push(
        `ILS ₪${c.finalIls.toFixed(2)} · ${method}`,
        `ilsBase=₪${c.ils.baseAmount.toFixed(2)} ilsVat=₪${c.ils.vatAmount.toFixed(2)}`,
        `ilsToUsd=$${c.convertedIlsUsd.toFixed(2)} @ ${rateN.toFixed(4)}`,
      );
    }
    const noteT = (n.note ?? n.usdNote ?? n.ilsNote ?? "").trim();
    if (noteT) parts.push(`note=${noteT}`);
    parts.push(`vatMode=${n.vatMode}`);
    return parts.join(" | ");
  });

  const commissionPctLine =
    commissionPctDec.gt(0) ? `אחוז עמלה כללי: ${commissionPctDec.toFixed(2)}%` : null;

  const combinedNotes = [
    "קליטת תשלום מעודכן (דו-מטבעי)",
    lineNotes ? `הערה: ${lineNotes}` : null,
    form.allowMethodDeviation ? METHOD_DEV_APPROVED_NOTE_TAG : null,
    `totalPaymentUsd: $${totals.totalUsd.toFixed(2)}`,
    surplusCommissionAbsorbedUsd > ALLOC_EPS
      ? `${PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL}: $${surplusCommissionAbsorbedUsd.toFixed(2)}`
      : null,
    `סה״כ דולר: $${totals.totalUsd.toFixed(2)} · סה״כ שקל: ₪${totals.totalIls.toFixed(2)} · שער: ${finalUse.toFixed(4)} (גלובלי ${finalGlobal.toFixed(4)})`,
    `בסיס: ${base.toFixed(4)} · עמלה: ${fee.toFixed(4)}`,
    commissionPctLine,
    ...breakdownLines,
    "נסגר אוטומטית לפי סדר הזמנות מהישן לחדש",
  ]
    .filter(Boolean)
    .join("\n");

  const firstOrderId = allocationEntries[0]?.[0] ?? null;
  const payWorkCountry =
    normalizeWorkCountryCode(form.workCountry) ??
    (await resolvePaymentWorkCountry({ orderId: firstOrderId, customerId: cid }));
  const allocated = await allocateNextPaymentCapture(payWorkCountry);
  const primaryCode = allocated.code;
  let savedCount = 0;

  const BALANCE_EPS = new Prisma.Decimal("0.01");
  let primaryPaymentId: string | null = null;

  /** רישומי Audit — מחוץ ל-transaction (לא חוסמים commit; רק DB writes קריטיים בתוך tx). */
  const pendingAudits: Prisma.AuditLogCreateManyInput[] = [];

  const allocOrderIds = [...new Set(allocationEntries.map(([id]) => id))];
  const allocOrdersById = new Map(
    (
      allocOrderIds.length > 0
        ? await prisma.order.findMany({
            where: { id: { in: allocOrderIds }, customerId: cid, deletedAt: null },
            select: {
              id: true,
              orderNumber: true,
              paymentMethod: true,
              paymentBreakdown: { select: { paymentMethod: true } },
            },
          })
        : []
    ).map((o) => [o.id, o] as const),
  );

  const overageOrderPrefetch =
    surplusCommissionOrderId && surplusCommissionAbsorbedUsd > ALLOC_EPS
      ? await prisma.order.findFirst({
          where: { id: surplusCommissionOrderId, customerId: cid, deletedAt: null },
          select: {
            id: true,
            orderNumber: true,
            amountUsd: true,
            commissionUsd: true,
            totalUsd: true,
          },
        })
      : null;

  const commissionResetIds = (form.commissionResetOrderIds ?? []).map((x) => x.trim()).filter(Boolean);
  const commissionResetOrdersPrefetch =
    commissionResetIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: commissionResetIds }, customerId: cid, deletedAt: null },
          select: { id: true, orderNumber: true, amountUsd: true, commissionUsd: true, totalUsd: true },
        })
      : [];
  const paidByCommissionResetOrder = new Map<string, Prisma.Decimal>();
  if (commissionResetOrdersPrefetch.length > 0) {
    const resetPaidAgg = await prisma.payment.groupBy({
      by: ["orderId"],
      where: {
        orderId: { in: commissionResetOrdersPrefetch.map((o) => o.id) },
        amountUsd: { not: null },
        ...activePaidPaymentWhere,
      },
      _sum: { amountUsd: true },
    });
    for (const s of resetPaidAgg) {
      if (s.orderId) paidByCommissionResetOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
    }
  }

  let balanceResetAudit: Prisma.AuditLogCreateManyInput | null = null;

  const debtScope = openDebtScopeForWorkCountry(payWorkCountry);
  const creditBeforeSave = await getCustomerInternalBalanceUsd(cid, debtScope);
  const creditAvailableUsd = creditBeforeSave.gt(BALANCE_EPS) ? creditBeforeSave : new Prisma.Decimal(0);

  if (form.applyCustomerBalanceReset && form.applyCustomerBalanceResetFromCredit) {
    return { ok: false, error: "לא ניתן לשלב שני סוגי איפוס יתרה" };
  }
  if (
    (form.applyCustomerBalanceReset || form.applyCustomerBalanceResetFromCredit) &&
    !isAdminUser(me)
  ) {
    return { ok: false, error: "אין הרשאת מנהל לאיפוס יתרה" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      let allocIndex = 0;
      for (const [orderId, allocUsd] of allocationEntries) {
        const amt = new Prisma.Decimal(allocUsd.toFixed(4));
        if (amt.lte(0)) continue;

        const order = allocOrdersById.get(orderId);
        if (!order) throw new Error("הזמנה לא נמצאה או שאינה של הלקוח");

        const totalsRow = computeFromUsdAmount(amt, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });

        const code = allocIndex === 0 ? primaryCode : null;
        const isPrimary = allocIndex === 0;
        const ilsOnRow = isPrimary ? totalIlsDec : null;

        const created = await tx.payment.create({
          data: {
            countryCode: payWorkCountry,
            paymentCode: code,
            paymentNumber: allocated.paymentNumber,
            orderId,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: ilsOnRow && totalIlsEntered > ALLOC_EPS ? "MIXED" : "USD",
            amountUsd: amt,
            amountIls: ilsOnRow,
            sourceCurrency: ilsOnRow && totalIlsEntered > ALLOC_EPS ? "MIXED" : "USD",
            sourceAmount: ilsOnRow && totalIlsEntered > ALLOC_EPS ? ilsOnRow : amt,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: ilsOnRow ? ilsOnRow : totalsRow.totalIlsWithoutVat,
            snapshotBaseDollarRate: totalsRow.snapshotBaseDollarRate,
            snapshotDollarFee: totalsRow.snapshotDollarFee,
            snapshotFinalDollarRate: totalsRow.snapshotFinalDollarRate,
            totalIlsWithVat: ilsOnRow ?? totalsRow.totalIlsWithVat,
            totalIlsWithoutVat: ilsOnRow ?? totalsRow.totalIlsWithoutVat,
            vatAmount: ilsOnRow ? null : totalsRow.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            notes: combinedNotes,
            createdById: me.id,
          },
        });
        if (allocIndex === 0) primaryPaymentId = created.id;

        // חריגת אמצעי תשלום: אם להזמנה יש תכנון מורכב ואמצעי התשלום בפועל אינו מהמתוכננים — לתעד Audit.
        if (isCompositePaymentMethod(order.paymentMethod) && order.paymentBreakdown.length > 0) {
          const plannedSet = new Set(order.paymentBreakdown.map((b) => b.paymentMethod));
          const actualMethodsUsed = [usdMethod, ilsMethod, payMethodDb].filter(
            (m): m is PaymentMethod => !!m && !isCompositePaymentMethod(m),
          );
          const deviatingMethods = [...new Set(actualMethodsUsed)].filter((m) => !plannedSet.has(m));
          if (deviatingMethods.length > 0) {
            pendingAudits.push({
              userId: me.id,
              actionType: "PAYMENT_METHOD_DEVIATION",
              entityType: "Order",
              entityId: order.id,
              oldValue: {
                plannedMethods: [...plannedSet],
              } as Prisma.InputJsonValue,
              newValue: {
                actualMethods: deviatingMethods,
              } as Prisma.InputJsonValue,
              metadata: {
                orderNumber: order.orderNumber ?? null,
                paymentId: created.id,
                paymentCode: code,
                amountUsd: amt.toFixed(2),
                plannedLabels: [...plannedSet].map((m) => PAYMENT_METHOD_LABELS[m] ?? m),
                actualLabels: deviatingMethods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m),
              } as Prisma.InputJsonValue,
            });
          }
        }

        allocIndex += 1;
        savedCount += 1;
      }

      if ((surplusAsCredit) && unallocatedUsd > ALLOC_EPS && !form.applyCustomerBalanceReset && !form.applyCustomerBalanceResetFromCredit) {
        const creditUsd = new Prisma.Decimal(unallocatedUsd.toFixed(4));
        const creditTotals = computeFromUsdAmount(creditUsd, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });
        const creditNotes = [
          "יתרת זכות ללקוח — עודף מתשלום",
          `קשור לקליטה ${primaryCode}`,
          `עודף: $${unallocatedUsd.toFixed(2)} (≈ ₪${Number(creditTotals.totalIlsWithVat).toFixed(2)})`,
        ].join("\n");
        await tx.payment.create({
          data: {
            countryCode: payWorkCountry,
            paymentCode: null,
            paymentNumber: allocated.paymentNumber,
            orderId: null,
            customerId: cid,
            weekCode,
            paymentDate,
            paymentPlace: null,
            currency: "USD",
            amountUsd: creditUsd,
            amountIls: null,
            sourceCurrency: "USD",
            sourceAmount: creditUsd,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: creditTotals.totalIlsWithoutVat,
            snapshotBaseDollarRate: creditTotals.snapshotBaseDollarRate,
            snapshotDollarFee: creditTotals.snapshotDollarFee,
            snapshotFinalDollarRate: creditTotals.snapshotFinalDollarRate,
            totalIlsWithVat: creditTotals.totalIlsWithVat,
            totalIlsWithoutVat: creditTotals.totalIlsWithoutVat,
            vatAmount: creditTotals.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            notes: creditNotes,
            createdById: me.id,
          },
        });
        savedCount += 1;
      }

      if (primaryPaymentId && flatChecksForPrimary.length > 0) {
        await tx.paymentCheck.createMany({
          data: flatChecksForPrimary.map((c) => ({
            paymentId: primaryPaymentId!,
            checkNumber: c.checkNumber,
            dueDate: c.dueDate,
            amount: c.amount,
          })),
        });
      }

      if (overageOrderPrefetch) {
        const overageOrder = overageOrderPrefetch;
        const deal = overageOrder.amountUsd ?? new Prisma.Decimal(0);
        const oldCom = overageOrder.commissionUsd ?? new Prisma.Decimal(0);
        const oldTotal = overageOrder.totalUsd ?? deal.add(oldCom).toDecimalPlaces(4, 4);
        const surplusDec = new Prisma.Decimal(surplusCommissionAbsorbedUsd.toFixed(4));
        const plan = planCommissionSurplusAbsorption({
          commissionUsd: oldCom,
          totalUsd: oldTotal,
          surplusUsd: surplusDec,
        });
        await tx.order.update({
          where: { id: overageOrder.id },
          data: {
            commissionUsd: plan.afterCommissionUsd,
            totalUsd: plan.afterTotalUsd,
            status: OS.COMPLETED,
          },
        });
        pendingAudits.push({
            userId: me.id,
            actionType: surplusToCommission
              ? "PAYMENT_SURPLUS_TO_COMMISSION"
              : "ORDER_COMMISSION_SMALL_OVERAGE_ABSORBED",
            entityType: "Order",
            entityId: overageOrder.id,
            oldValue: {
              commissionUsd: plan.beforeCommissionUsd.toString(),
              totalUsd: plan.beforeTotalUsd.toString(),
            } as Prisma.InputJsonValue,
            newValue: {
              commissionUsd: plan.afterCommissionUsd.toString(),
              totalUsd: plan.afterTotalUsd.toString(),
              status: OS.COMPLETED,
              remainingUsd: "0",
            } as Prisma.InputJsonValue,
            metadata: {
              orderNumber: overageOrder.orderNumber ?? null,
              paymentPrimaryCode: primaryCode,
              surplusUsd: surplusCommissionAbsorbedUsd.toFixed(2),
              ledgerLabel: surplusToCommission
                ? PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL
                : PAYMENT_SMALL_OVERAGE_COMMISSION_ABSORPTION_LABEL,
              userChoice: surplusToCommission ? "commission" : "auto_small_overage",
            } as Prisma.InputJsonValue,
          });
      }

      if (commissionResetOrdersPrefetch.length > 0) {
        const resetUpdates: Prisma.PrismaPromise<unknown>[] = [];

        for (const o of commissionResetOrdersPrefetch) {
          const deal = o.amountUsd ?? new Prisma.Decimal(0);
          const oldCom = o.commissionUsd ?? new Prisma.Decimal(0);
          const oldTotal = o.totalUsd ?? deal.add(oldCom).toDecimalPlaces(4, 4);
          const paid = paidByCommissionResetOrder.get(o.id) ?? new Prisma.Decimal(0);
          if (oldTotal.sub(paid).lte(BALANCE_EPS)) continue;

          const plan = planCommissionDebtClosure({
            commissionUsd: oldCom,
            totalUsd: oldTotal,
            paidUsd: paid,
          });

          resetUpdates.push(
            tx.order.update({
              where: { id: o.id },
              data: {
                commissionUsd: plan.afterCommissionUsd,
                totalUsd: plan.afterTotalUsd,
                status: OS.COMPLETED,
              },
            }),
          );

          pendingAudits.push({
            userId: me.id,
            actionType: "ORDER_COMMISSION_RESET",
            entityType: "Order",
            entityId: o.id,
            oldValue: {
              commissionUsd: plan.beforeCommissionUsd.toString(),
              totalUsd: plan.beforeTotalUsd.toString(),
              paidUsd: paid.toString(),
              remainingUsd: plan.remainingUsd.toString(),
            } as Prisma.InputJsonValue,
            newValue: {
              commissionUsd: plan.afterCommissionUsd.toString(),
              totalUsd: plan.afterTotalUsd.toString(),
              remainingUsd: "0",
              status: OS.COMPLETED,
            } as Prisma.InputJsonValue,
            metadata: {
              orderNumber: o.orderNumber ?? null,
              paymentPrimaryCode: primaryCode,
              ledgerLabel: COMMISSION_DEBT_CLOSURE_LEDGER_LABEL,
              beforeCommissionUsd: plan.beforeCommissionUsd.toString(),
              afterCommissionUsd: plan.afterCommissionUsd.toString(),
              beforeRemainingUsd: plan.remainingUsd.toString(),
              afterRemainingUsd: "0",
            } as Prisma.InputJsonValue,
          });
        }

        if (resetUpdates.length > 0) {
          await Promise.all(resetUpdates);
        }
      }

      if (form.applyCustomerBalanceResetFromCredit) {
        const resetResult = await applyCustomerBalanceResetFromCreditInTx(tx, {
          customerId: cid,
          weekCode,
          userId: me.id,
          creditAvailableUsd,
          primaryPaymentCode: primaryCode,
          paymentNumber: allocated.paymentNumber,
          payWorkCountry,
          paymentDate,
          manualDateChanged,
        });
        balanceResetAudit = resetResult.auditEntry;
        savedCount += resetResult.paymentCount;
      } else if (form.applyCustomerBalanceReset) {
        const resetResult = await applyCustomerOutstandingBalanceResetInTx(tx, {
          customerId: cid,
          weekCode,
          userId: me.id,
        });
        balanceResetAudit = resetResult.auditEntry;
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  const auditBatch = balanceResetAudit ? [...pendingAudits, balanceResetAudit] : pendingAudits;
  if (auditBatch.length > 0) {
    await prisma.auditLog.createMany({ data: auditBatch });
  }

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(cid);
  await persistCustomerBalanceSnapshot(cid, customerBalanceUsd);
  scheduleRevalidateAfterPaymentSave();
  return {
    ok: true,
    saved: {
      primaryPaymentCode: primaryCode,
      primaryPaymentId: primaryPaymentId,
      count: savedCount,
      customerBalanceUsd: customerBalanceUsd.toFixed(2),
    },
  };
}

/** חישוב איפוס יתרה — סגירה מלאה ל-0 (חוסר או עודף) באמצעות התאמת עמלה */
function planOrderBalanceReset(params: {
  amountUsd: Prisma.Decimal;
  commissionUsd: Prisma.Decimal;
  totalUsd: Prisma.Decimal;
  paidUsd: Prisma.Decimal;
}) {
  void params.amountUsd;
  return planBalanceResetToZero({
    commissionUsd: params.commissionUsd,
    totalUsd: params.totalUsd,
    paidUsd: params.paidUsd,
  });
}

/**
 * "איפוס יתרה" — פעולה חשבונאית על שורת הזמנה:
 * סגירת יתרה (total = amount + עמלה שלילית), עמלה חיובית → שלילית, ללא שורת תיקון.
 */
export async function resetOrderBalanceAction(input: {
  orderId: string;
}): Promise<
  | {
      ok: true;
      resetUsd: string;
      affectedOrderIds: string[];
      affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לאיפוס יתרה" };
  }

  const oid = (input.orderId || "").trim();
  if (!oid) return { ok: false, error: "חסר מזהה הזמנה" };

  const EPS = new Prisma.Decimal("0.01");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.order.findFirst({
        where: { id: oid, deletedAt: null },
        select: {
          id: true,
          customerId: true,
          orderNumber: true,
          amountUsd: true,
          commissionUsd: true,
          totalUsd: true,
        },
      });
      if (!target) throw new Error("הזמנה לא נמצאה");
      if (!target.customerId) throw new Error("להזמנה אין לקוח");

      const deal = target.amountUsd ?? new Prisma.Decimal(0);
      const com = target.commissionUsd ?? new Prisma.Decimal(0);
      const totalOrd = target.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);

      const payAgg = await tx.payment.aggregate({
        where: { orderId: oid, amountUsd: { not: null }, ...activePaidPaymentWhere },
        _sum: { amountUsd: true },
      });
      const paid = payAgg._sum.amountUsd ?? new Prisma.Decimal(0);
      const remaining = totalOrd.sub(paid).toDecimalPlaces(4, 4);
      if (remaining.abs().lte(EPS)) {
        throw new Error("אין יתרה לאיפוס בהזמנה");
      }

      const plan = planOrderBalanceReset({
        amountUsd: deal,
        commissionUsd: com,
        totalUsd: totalOrd,
        paidUsd: paid,
      });

      await tx.order.update({
        where: { id: oid },
        data: {
          commissionUsd: plan.afterCommissionUsd,
          totalUsd: plan.afterTotalUsd,
          status: OS.COMPLETED,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: "ORDER_BALANCE_RESET",
          entityType: "Order",
          entityId: oid,
          oldValue: {
            amountUsd: deal.toString(),
            commissionUsd: plan.beforeCommissionUsd.toString(),
            totalUsd: plan.beforeTotalUsd.toString(),
            paidUsd: paid.toString(),
            remainingUsd: plan.remainingUsd.toString(),
          } as Prisma.InputJsonValue,
          newValue: {
            amountUsd: deal.toString(),
            commissionUsd: plan.afterCommissionUsd.toString(),
            totalUsd: plan.afterTotalUsd.toString(),
            status: OS.COMPLETED,
            remainingUsd: "0",
          } as Prisma.InputJsonValue,
          metadata: {
            orderNumber: target.orderNumber ?? null,
            resetUsd: plan.remainingUsd.toString(),
            writeOffUsd: plan.remainingUsd.toString(),
            ledgerLabel: BALANCE_RESET_LEDGER_LABEL,
            beforeCommissionUsd: plan.beforeCommissionUsd.toString(),
            afterCommissionUsd: plan.afterCommissionUsd.toString(),
            beforeRemainingUsd: plan.remainingUsd.toString(),
            afterRemainingUsd: "0",
          } as Prisma.InputJsonValue,
        },
      });

      return {
        resetUsd: plan.remainingUsd.toFixed(2),
        affectedOrderIds: [oid],
        affectedOrderUpdates: [
          {
            orderId: oid,
            newCommissionUsd: plan.afterCommissionUsd.toFixed(2),
            newTotalUsd: plan.afterTotalUsd.toFixed(2),
          },
        ],
      };
    });

    const targetAfter = await prisma.order.findFirst({
      where: { id: oid },
      select: { customerId: true },
    });
    if (targetAfter?.customerId) {
      const customerBalanceUsd = await getCustomerInternalBalanceUsd(targetAfter.customerId);
      await persistCustomerBalanceSnapshot(targetAfter.customerId, customerBalanceUsd);
    }

    revalidateAllKpiCaches();
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");

    return {
      ok: true,
      resetUsd: result.resetUsd,
      affectedOrderIds: result.affectedOrderIds,
      affectedOrderUpdates: result.affectedOrderUpdates,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "איפוס יתרה נכשל";
    return { ok: false, error: msg };
  }
}

/** איפוס יתרה מתוך יתרת זכות — תשלומי הקצאה פנימיים (ללא מזומן) */
async function applyCustomerBalanceResetFromCreditInTx(
  tx: Prisma.TransactionClient,
  params: {
    customerId: string;
    weekCode: string | null;
    userId: string;
    creditAvailableUsd: Prisma.Decimal;
    primaryPaymentCode: string;
    paymentNumber: number;
    payWorkCountry: WorkCountryCode;
    paymentDate: Date;
    manualDateChanged: boolean;
  },
): Promise<{
  totalResetUsd: string;
  closedOrderIds: string[];
  paymentCount: number;
  auditEntry: Prisma.AuditLogCreateManyInput;
}> {
  const cid = params.customerId;
  const weekCode = params.weekCode?.trim() || null;
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const EPS = new Prisma.Decimal("0.01");

  const orders = await tx.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      orderNumber: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
    },
  });
  if (orders.length === 0) throw new Error("לא נמצאו הזמנות ללקוח");

  const orderIds = orders.map((o) => o.id);
  const sums = await tx.payment.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
    _sum: { amountUsd: true },
  });
  const paidByOrder = new Map<string, Prisma.Decimal>();
  for (const s of sums) {
    if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
  }

  const toClose: Array<{
    orderId: string;
    orderNumber: string | null;
    remainingUsd: Prisma.Decimal;
  }> = [];

  for (const o of orders) {
    const amount = o.amountUsd ?? new Prisma.Decimal(0);
    const commissionStored = o.commissionUsd ?? new Prisma.Decimal(0);
    const total = o.totalUsd ?? amount.add(commissionStored).toDecimalPlaces(4, 4);
    const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const remaining = total.sub(paid).toDecimalPlaces(4, 4);
    if (remaining.abs().lte(EPS)) continue;
    toClose.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      remainingUsd: remaining,
    });
  }

  if (toClose.length === 0) throw new Error("אין יתרה פתוחה לאיפוס");

  const totalRequired = toClose.reduce(
    (acc, x) => acc.add(x.remainingUsd),
    new Prisma.Decimal(0),
  );

  if (params.creditAvailableUsd.lt(totalRequired.sub(EPS))) {
    throw new Error(
      `יתרת זכות ($${params.creditAvailableUsd.toFixed(2)}) אינה מספיקה לאיפוס ($${totalRequired.toFixed(2)})`,
    );
  }

  const creditBefore = params.creditAvailableUsd.toDecimalPlaces(2, 4);
  const creditAfter = creditBefore.sub(totalRequired).toDecimalPlaces(2, 4);

  for (const row of toClose) {
    const notes = [
      BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
      `קשור לקליטה ${params.primaryPaymentCode}`,
      `סכום: $${row.remainingUsd.toFixed(2)}`,
      `יתרת זכות לפני: $${creditBefore.toFixed(2)}`,
    ].join("\n");
    await tx.payment.create({
      data: {
        countryCode: params.payWorkCountry ?? DEFAULT_WORK_COUNTRY,
        paymentCode: null,
        paymentNumber: params.paymentNumber,
        orderId: row.orderId,
        customerId: cid,
        weekCode,
        paymentDate: params.paymentDate,
        currency: "USD",
        amountUsd: row.remainingUsd,
        sourceCurrency: "USD",
        sourceAmount: row.remainingUsd,
        manualDateChanged: params.manualDateChanged,
        paymentMethod: PaymentMethod.OTHER,
        usdPaymentMethod: PaymentMethod.OTHER,
        isPaid: true,
        notes,
        createdById: params.userId,
      },
    });
  }

  const closedIds = toClose.map((x) => x.orderId);

  const auditEntry: Prisma.AuditLogCreateManyInput = {
    userId: params.userId,
    actionType: "CUSTOMER_BALANCE_RESET_FROM_CREDIT",
    entityType: "Customer",
    entityId: cid,
    oldValue: {
      creditAvailableUsd: creditBefore.toString(),
      totalRemainingUsd: totalRequired.toString(),
      weekCode,
      orderCount: closedIds.length,
    } as Prisma.InputJsonValue,
    newValue: {
      creditAfterUsd: creditAfter.toString(),
      creditUsedUsd: totalRequired.toString(),
      closedOrderIds: closedIds,
    } as Prisma.InputJsonValue,
    metadata: {
      ledgerLabel: BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
      paymentPrimaryCode: params.primaryPaymentCode,
      creditBeforeUsd: creditBefore.toString(),
      creditAfterUsd: creditAfter.toString(),
      closedOrders: toClose.map((x) => ({
        orderId: x.orderId,
        orderNumber: x.orderNumber ?? null,
        resetUsd: x.remainingUsd.toString(),
        ledgerLabel: BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL,
      })),
      totalResetUsd: totalRequired.toString(),
    } as Prisma.InputJsonValue,
  };

  return {
    totalResetUsd: totalRequired.toFixed(2),
    closedOrderIds: closedIds,
    paymentCount: toClose.length,
    auditEntry,
  };
}

/** איפוס יתרה לכל הזמנות פתוחות של לקוח — בתוך transaction קיימת (רק עדכוני DB; Audit מחוץ ל-tx). */
async function applyCustomerOutstandingBalanceResetInTx(
  tx: Prisma.TransactionClient,
  params: { customerId: string; weekCode: string | null; userId: string },
): Promise<{
  totalResetUsd: string;
  closedOrderIds: string[];
  affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
  auditEntry: Prisma.AuditLogCreateManyInput;
}> {
  const cid = params.customerId;
  const weekCode = params.weekCode?.trim() || null;
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  const EPS = new Prisma.Decimal("0.01");

  const orders = await tx.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
    },
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      orderNumber: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
    },
  });
  if (orders.length === 0) throw new Error("לא נמצאו הזמנות ללקוח");

  const orderIds = orders.map((o) => o.id);
  const sums = await tx.payment.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
    _sum: { amountUsd: true },
  });
  const paidByOrder = new Map<string, Prisma.Decimal>();
  for (const s of sums) {
    if (s.orderId) paidByOrder.set(s.orderId, s._sum.amountUsd ?? new Prisma.Decimal(0));
  }

  const orderResets: Array<{
    orderId: string;
    orderNumber: string | null;
    plan: ReturnType<typeof planOrderBalanceReset>;
    paidUsd: Prisma.Decimal;
    amountUsd: Prisma.Decimal;
  }> = [];

  for (const o of orders) {
    const amount = o.amountUsd ?? new Prisma.Decimal(0);
    const commissionStored = o.commissionUsd ?? new Prisma.Decimal(0);
    const total = o.totalUsd ?? amount.add(commissionStored).toDecimalPlaces(4, 4);
    const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const remaining = total.sub(paid).toDecimalPlaces(4, 4);
    if (remaining.abs().lte(EPS)) continue;

    orderResets.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      amountUsd: amount,
      paidUsd: paid,
      plan: planOrderBalanceReset({
        amountUsd: amount,
        commissionUsd: commissionStored,
        totalUsd: total,
        paidUsd: paid,
      }),
    });
  }

  if (orderResets.length === 0) {
    throw new Error("אין יתרה פתוחה לאיפוס");
  }

  const totalRemaining = orderResets.reduce(
    (acc, x) => acc.add(x.plan.remainingUsd),
    new Prisma.Decimal(0),
  );

  await Promise.all(
    orderResets.map((row) =>
      tx.order.update({
        where: { id: row.orderId },
        data: {
          commissionUsd: row.plan.afterCommissionUsd,
          totalUsd: row.plan.afterTotalUsd,
          status: OS.COMPLETED,
        },
      }),
    ),
  );

  const closedIds = orderResets.map((x) => x.orderId);

  const auditEntry: Prisma.AuditLogCreateManyInput = {
    userId: params.userId,
    actionType: "CUSTOMER_BALANCES_RESET",
    entityType: "Customer",
    entityId: cid,
    oldValue: {
      totalRemainingUsd: totalRemaining.toString(),
      weekCode,
      orderCount: closedIds.length,
    } as Prisma.InputJsonValue,
    newValue: {
      closedOrderIds: closedIds,
      totalResetUsd: totalRemaining.toString(),
    } as Prisma.InputJsonValue,
    metadata: {
      ledgerLabel: BALANCE_RESET_LEDGER_LABEL,
      closedOrders: orderResets.map((x) => ({
        orderId: x.orderId,
        orderNumber: x.orderNumber ?? null,
        remainingUsd: x.plan.remainingUsd.toString(),
        beforeCommissionUsd: x.plan.beforeCommissionUsd.toString(),
        afterCommissionUsd: x.plan.afterCommissionUsd.toString(),
        beforeTotalUsd: x.plan.beforeTotalUsd.toString(),
        afterTotalUsd: x.plan.afterTotalUsd.toString(),
        amountUsd: x.amountUsd.toString(),
        paidUsd: x.paidUsd.toString(),
        ledgerLabel: BALANCE_RESET_LEDGER_LABEL,
      })),
      totalResetUsd: totalRemaining.toString(),
    } as Prisma.InputJsonValue,
  };

  return {
    totalResetUsd: totalRemaining.toFixed(2),
    closedOrderIds: closedIds,
    affectedOrderUpdates: orderResets.map((x) => ({
      orderId: x.orderId,
      newCommissionUsd: x.plan.afterCommissionUsd.toFixed(2),
      newTotalUsd: x.plan.afterTotalUsd.toFixed(2),
    })),
    auditEntry,
  };
}

/**
 * "איפוס יתרה" ברמת לקוח — לכל הזמנה עם יתרה פתוחה:
 * סגירת חוב + עמלה שלילית באותה שורה (ללא בדיקת "עמלה זמינה").
 */
export async function resetCustomerOutstandingBalancesAction(input: {
  customerId: string;
  /** אותו סינון שבוע AH כמו בטבלת הקליטה — יתרות עד סוף השבוע */
  weekCode?: string | null;
  /** אחוז עמלה מהקליטה — לחישוב עמלה משוערת כשאין commissionUsd בהזמנה */
  commissionPercent?: string | null;
}): Promise<
  | {
      ok: true;
      totalResetUsd: string;
      closedOrderIds: string[];
      affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לאיפוס יתרה" };
  }

  const cid = (input.customerId || "").trim();
  if (!cid) return { ok: false, error: "חסר מזהה לקוח" };

  const weekCode = input.weekCode?.trim() || null;

  try {
    const result = await prisma.$transaction(async (tx) =>
      applyCustomerOutstandingBalanceResetInTx(tx, {
        customerId: cid,
        weekCode,
        userId: me.id,
      }),
    );

    await prisma.auditLog.create({ data: result.auditEntry });

    const customerBalanceUsd = await getCustomerInternalBalanceUsd(cid);
    await persistCustomerBalanceSnapshot(cid, customerBalanceUsd);

    revalidateAllKpiCaches();
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");

    return {
      ok: true,
      totalResetUsd: result.totalResetUsd,
      closedOrderIds: result.closedOrderIds,
      affectedOrderUpdates: result.affectedOrderUpdates,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "איפוס יתרה נכשל";
    return { ok: false, error: msg };
  }
}

/** ביטול קליטת תשלום — דורש אישור מנהל; ראה createInvoiceCancelRequestAction */
export async function cancelPaymentAction(input: {
  paymentId: string;
  reason?: string | null;
}): Promise<
  | { ok: true; customerBalanceUsd: string; paymentCode: string | null }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }
  void input;
  return {
    ok: false,
    error: "ביטול חשבונית דורש אישור מנהל — שלחו בקשה דרך «ביטול חשבונית»",
  };
}

/** שחזור תשלום שבוטל */
export async function restorePaymentAction(input: {
  paymentId: string;
  reason?: string | null;
}): Promise<{ ok: true; customerBalanceUsd: string } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לשחזור תשלום" };
  }

  const pid = (input.paymentId || "").trim();
  if (!pid) return { ok: false, error: "חסר מזהה תשלום" };

  await ensurePaymentRecordStatusColumns();

  const row = await prisma.payment.findFirst({
    where: { id: pid, customerId: { not: null } },
    select: { id: true, paymentNumber: true, customerId: true, status: true },
  });
  if (!row?.customerId) return { ok: false, error: "תשלום לא נמצא" };
  if (row.status !== PAYMENT_RECORD_STATUS_CANCELLED) {
    return { ok: false, error: "התשלום אינו מבוטל" };
  }

  const reason = (input.reason ?? "").trim() || null;
  const restoreWhere =
    row.paymentNumber != null ? { paymentNumber: row.paymentNumber } : { id: row.id };

  await prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: restoreWhere,
      data: {
        status: PAYMENT_RECORD_STATUS_ACTIVE,
        cancelledAt: null,
        cancelledById: null,
        cancelReason: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: me.id,
        actionType: "PaymentRestored",
        entityType: "Payment",
        entityId: row.id,
        oldValue: { status: PAYMENT_RECORD_STATUS_CANCELLED } as Prisma.InputJsonValue,
        newValue: { status: PAYMENT_RECORD_STATUS_ACTIVE } as Prisma.InputJsonValue,
        metadata: {
          paymentId: row.id,
          paymentNumber: row.paymentNumber,
          customerId: row.customerId,
          reason,
        } as Prisma.InputJsonValue,
      },
    });
  });

  recordActivityAudit({
    userId: me.id,
    actionType: "PaymentRestored",
    entityType: "Payment",
    entityId: row.id,
    metadata: {
      paymentId: row.id,
      paymentNumber: row.paymentNumber,
      customerId: row.customerId,
      reason,
      dateTime: new Date().toISOString(),
    },
  });

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(row.customerId);
  await persistCustomerBalanceSnapshot(row.customerId, customerBalanceUsd);

  revalidateAllKpiCaches();
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/source-tables/payments");

  return { ok: true, customerBalanceUsd: customerBalanceUsd.toFixed(2) };
}
