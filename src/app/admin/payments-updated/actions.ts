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
import {
  orderLedgerBalanceUsd,
  roundMoney2,
  toPaymentIntakeBases,
} from "@/lib/payment-intake";
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
import { closePaymentPlansForOrdersInTx } from "@/lib/payment-plan-service";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { prisma } from "@/lib/prisma";
import { allocateNextPaymentCapture, resolvePaymentWorkCountry } from "@/lib/payment-capture-code";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import {
  getCustomerInternalBalanceUsd,
  openDebtScopeForWorkCountry,
  persistCustomerBalanceSnapshot,
} from "@/lib/customer-open-debt";
import { formatLocalYmd, getWeekCodeForLocalDate, parseLocalDate, parseLocalDateTime } from "@/lib/work-week";
import {
  calculatePaymentLine,
  calculateTotals,
  normalizePaymentLine,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import { aggregateLivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import {
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  type EnteredBucketUsd,
} from "@/lib/payment-breakdown-shared";
import {
  buildIntakeBreakdownPlan,
  computePerMethodSurplus,
} from "@/lib/cash-control-intake-breakdown";
import {
  applyDualCurrencyMatching,
  methodBalanceFromBreakdownRow,
  type DualCurrencyMatchingResult,
  type EnteredBucketAmount,
} from "@/lib/payment-method-matching-engine";
import { evaluatePaymentBusinessRules } from "@/lib/payment-business-validation";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { VAT_RATE } from "@/lib/vat";
import { prismaVatRatePercent } from "@/lib/vat-prisma";
import { recordActivityAudit } from "@/lib/activity-audit";
import {
  activePaidPaymentWhere,
  ensurePaymentRecordStatusColumns,
  PAYMENT_RECORD_STATUS_ACTIVE,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status";
import { loadOrderClosureSnapshot } from "@/lib/payment-closure-recalc";
import {
  BALANCE_RESET_TOLERANCE_USD,
  balanceResetLedgerLabel,
  buildOrderBalanceResetAuditPayload,
  calculateBalanceReset,
  isBalanceResetStillApplicable,
  pickOverpaymentCreditsToCancel,
} from "@/lib/balance-reset-calculation";
import { CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } from "@/lib/cash-control-internal-payments";
import {
  buildPaymentAdjustmentFeeCreateData,
  PAYMENT_ADJUSTMENT_FEE_NOTE_PREFIX,
} from "@/lib/payment-adjustment-fee";
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
  const m = (method ?? "").trim().toUpperCase();
  if (m === "CREDIT" || m === "CREDIT_CARD" || m === "CARD") return PaymentMethod.CREDIT;
  if (m === "BANK_TRANSFER" || m === "TRANSFER" || m === "BANK" || m === "BANK_TRANSFER_DONE") {
    return PaymentMethod.BANK_TRANSFER;
  }
  if (m === "CASH") return PaymentMethod.CASH;
  if (m === "CHECK" || m === "CHECKS" || m === "CHEQUE") return PaymentMethod.CHECK;
  if (m === "OTHER") return PaymentMethod.OTHER;
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
  /**
   * תאריך ביצוע קליטת תשלום (YYYY-MM-DD) — לבקרת קופה בלבד.
   * ברירת מחדל: היום. לא משנה weekCode / FIFO / הזמנות.
   */
  intakeDateYmd?: string | null;
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
  /** עודף תשלום — credit = יתרת זכות; commission = הכנסה/עמלות; forfeit = ויתור */
  surplusDisposition?: "credit" | "commission" | "forfeit" | null;
  /**
   * העברות חוב בין אמצעי תשלום שאושרו במפורש ע״י המשתמש.
   * מיושמות על תכנון האמצעים לפני אכיפת החוק העסקי.
   */
  approvedDebtTransfers?: Array<{
    fromBucket: "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER";
    toBucket: "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER";
    amountUsd: number;
    fromLabel?: string;
    toLabel?: string;
  }> | null;
  /** מדינת קליטה מהמסך — מקצה TR-P / CN-P / AE-P נפרד */
  workCountry?: string | null;
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
  if (
    form.applyCustomerBalanceReset ||
    form.applyCustomerBalanceResetFromCredit ||
    (form.commissionResetOrderIds?.length ?? 0) > 0
  ) {
    return {
      ok: false,
      error:
        "פעולות טיפול בחוסר זמינות רק לאחר שמירת התשלום, דרך חלון סיכום התשלום.",
    };
  }
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

  // חוק עסקי ראשון — אימות אמצעי התשלום המתוכננים לפני כל חישוב הקצאה/FIFO.
  const intakeOrdersResult = await loadPaymentIntakeOrdersForCustomer({
    customerId: cid,
    weekCodeForOpenBalances: form.weekCode,
    paymentWorkCountryRaw: form.workCountry,
  });
  if (!intakeOrdersResult.ok) return intakeOrdersResult;
  const plannedMethods = buildIntakeBreakdownPlan(
    intakeOrdersResult.orders,
    form.includedOrderIds,
  );
  const methodKpis = aggregateLivePaymentFormKpis(form.payments ?? [], rateN);
  /** הפרדת מטבעות: entered USD / entered ILS בנפרד — בלי המרה לצורך Matching */
  const enteredMethods: EnteredBucketAmount[] = [
    { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, currency: "USD", entered: methodKpis.cash.enteredUsd },
    { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, currency: "USD", entered: methodKpis.bankTransfer.enteredUsd },
    { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, currency: "USD", entered: methodKpis.credit.enteredUsd },
    { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, currency: "USD", entered: methodKpis.checks.enteredUsd },
    { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, currency: "USD", entered: methodKpis.other.enteredUsd },
    { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, currency: "ILS", entered: methodKpis.cash.enteredIls },
    { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, currency: "ILS", entered: methodKpis.bankTransfer.enteredIls },
    { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, currency: "ILS", entered: methodKpis.credit.enteredIls },
    { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, currency: "ILS", entered: methodKpis.checks.enteredIls },
    { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, currency: "ILS", entered: methodKpis.other.enteredIls },
  ];
  /** לגשרים ישנים (validatePaymentMethods) — USD בלבד + המרת ILS לצורך אכיפה זמנית */
  const enteredMethodsUsdCompat: EnteredBucketUsd[] = [
    { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: methodKpis.cash.totalUsd },
    {
      bucket: "BANK_TRANSFER",
      label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER,
      enteredUsd: methodKpis.bankTransfer.totalUsd,
    },
    { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, enteredUsd: methodKpis.credit.totalUsd },
    { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, enteredUsd: methodKpis.checks.totalUsd },
    { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, enteredUsd: methodKpis.other.totalUsd },
  ];
  const selectedOrderIds =
    form.includedOrderIds == null ? null : new Set(form.includedOrderIds);
  const selectedIntakeOrders = intakeOrdersResult.orders.filter(
    (order) => selectedOrderIds == null || selectedOrderIds.has(order.id),
  );
  const totalDebtUsd = roundMoney2(
    selectedIntakeOrders.reduce(
      (sum, order) => sum + Math.max(0, Number(order.dbRemainingUsd) || 0),
      0,
    ),
  );
  const availableCreditUsd = Math.max(
    0,
    Number(
      await getCustomerInternalBalanceUsd(
        cid,
        openDebtScopeForWorkCountry(form.workCountry),
      ),
    ),
  );
  const availableCommissionUsd = roundMoney2(
    selectedIntakeOrders.reduce(
      (sum, order) => sum + Math.max(0, Number(order.commissionUsd) || 0),
      0,
    ),
  );
  const businessDecision = evaluatePaymentBusinessRules({
    plannedByMethod: plannedMethods,
    enteredByMethod: enteredMethodsUsdCompat,
    totalDebtUsd,
    totalPaymentUsd: totals.totalUsd,
    availableCreditUsd,
    availableCommissionUsd,
    // ההבחנה חלקי/סגירה נקבעת ב-classifySettlementIntent; כאן רק מדווחים
    // אם המשתמש ביקש סגירה מפורשת (איפוס יתרה / איפוס עמלה).
    explicitClosureRequested:
      Boolean(form.applyCustomerBalanceReset) ||
      Boolean(form.applyCustomerBalanceResetFromCredit) ||
      (form.commissionResetOrderIds?.length ?? 0) > 0,
    useCredit: Boolean(form.applyCustomerBalanceResetFromCredit),
    useCommission:
      Boolean(form.applyCustomerBalanceReset) ||
      (form.commissionResetOrderIds?.length ?? 0) > 0,
    allowNegativeCommission: Boolean(form.applyCustomerBalanceReset) && isAdminUser(me),
    // זרימת save-first: חוסר אינו חוסם את קליטת התשלום — נשמר כחוב פתוח.
    deferShortageResolution: true,
    surplusDisposition:
      form.surplusDisposition ??
      (form.saveSurplusAsCredit ? "credit" : null),
    // העברת חוב בין אמצעים בוטלה — שינוי אמצעי רק במסך אמצעי מתוכננים.
    approvedDebtTransfers: null,
    requiredApprovalGranted: isAdminUser(me),
  });
  if (!businessDecision.ok) {
    return { ok: false, error: businessDecision.message };
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

  const intakeYmd = (form.intakeDateYmd ?? "").trim() || todayYmd;
  const intakeDate = hm ? parseLocalDateTime(intakeYmd, hm) : parseLocalDate(intakeYmd);

  const weekCode = (form.weekCode?.trim() || getWeekCodeForLocalDate(paymentDate)).trim() || null;

  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);
  // חשוב: יתרת זכות קיימת לא "כופה" תשלום כקרדיט.
  // תמיד מבצעים FIFO allocation קודם; רק עודף (unallocated) מטופל כקרדיט/עמלה לפי בחירת משתמש.
  const forceCreditPayment = false;

  // Load ALL open orders for FIFO allocation — no week-date filter.
  // The client-side FIFO engine also operates on the full order list (no date window),
  // so the server must be consistent. Filtering by weekDateWhere here was the root cause
  // of "אין יעד להקצאה לסכום הדולר" when the open order's orderDate fell outside the
  // AH-week window even though the UI clearly showed it as having open debt.
  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      status: { not: OS.DEBT_WITHDRAWAL },
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
  /** עודף שהמשתמש בחר להעביר לעמלות/הפרשי התאמה — ללא הקצאה נוספת */
  let surplusFeeUsd = 0;
  /** Matching Engine — מצב אמצעים לשמירה ב-DB (דו-מטבעי) */
  let matchingResult: DualCurrencyMatchingResult | null = null;
  /** האם Matching רץ על מועמדים עם חלוקת אמצעים */
  let usedMethodMatching = false;
  /** סכום יתרות אמצעים פתוחים אחרי Matching/seed — לזיהוי הודעת שגיאה מדויקת */
  let openMethodRemainingUsd = 0;
  /** ויתור על עודף → הוספה לעמלת הזמנה */
  let forfeitToCommissionUsd = 0;
  let forfeitCommissionOrderId: string | null = null;
  const surplusAsCredit =
    form.saveSurplusAsCredit || form.surplusDisposition === "credit";
  const surplusToCommission = form.surplusDisposition === "commission";
  const surplusForfeit = form.surplusDisposition === "forfeit";

  const resolveForfeitOrderId = (): string | null => {
    if (allocationEntries.length > 0) {
      return allocationEntries[allocationEntries.length - 1]![0];
    }
    const idSet =
      form.includedOrderIds == null ? null : new Set(form.includedOrderIds.filter(Boolean));
    const list = intakeOrdersResult.orders.filter((o) => idSet == null || idSet.has(o.id));
    return list.length > 0 ? list[list.length - 1]!.id : null;
  };

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
      // ── Matching Engine: מקור אמת יחיד להקצאה לפי אמצעי תשלום ──
      const selectedIds =
        form.includedOrderIds == null
          ? null
          : new Set((form.includedOrderIds ?? []).filter(Boolean));
      const candidateOrders = intakeOrdersResult.orders.filter(
        (o) =>
          o.breakdown.length > 0 &&
          Number(o.dbRemainingUsd) > ALLOC_EPS &&
          (selectedIds == null || selectedIds.has(o.id)),
      );
      const candidateIds = candidateOrders.map((o) => o.id);

      if (candidateIds.length > 0) {
        usedMethodMatching = true;
        const dbLines = await prisma.orderPaymentBreakdown.findMany({
          where: { orderId: { in: candidateIds } },
          orderBy: [{ orderId: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            orderId: true,
            paymentMethod: true,
            amount: true,
            currency: true,
            paidAmount: true,
            remainingAmount: true,
          },
        });
        const orderRate = new Map(
          candidateOrders.map((o) => {
            const r = Number((o.rate || "").replace(",", "."));
            return [o.id, r > 0 ? r : rateN] as const;
          }),
        );
        const balances = dbLines.map((line) =>
          methodBalanceFromBreakdownRow({
            breakdownId: line.id,
            orderId: line.orderId,
            paymentMethod: line.paymentMethod,
            amount: Number(line.amount.toString()),
            currency: line.currency,
            paidAmount: Number(line.paidAmount?.toString?.() ?? line.paidAmount ?? 0),
            remainingAmount:
              line.remainingAmount != null ? Number(line.remainingAmount.toString()) : null,
          }),
        );

        // Seed מ־PaymentMethodAllocation כש־paid עדיין 0 (לפני Matching Engine) — לפי מטבע
        const seededPaidSum = balances.reduce((s, b) => s + b.paid, 0);
        if (seededPaidSum <= ALLOC_EPS) {
          const priorPays = await prisma.payment.findMany({
            where: {
              orderId: { in: candidateIds },
              status: "ACTIVE",
              amountUsd: { not: null },
            },
            select: {
              id: true,
              orderId: true,
              methodAllocations: {
                select: { method: true, currency: true, sourceAmount: true, amountUsd: true },
              },
            },
          });
          const paidByOrderKey = new Map<string, Map<string, number>>();
          for (const p of priorPays) {
            if (!p.orderId) continue;
            for (const a of p.methodAllocations) {
              const cur = a.currency?.toUpperCase() === "ILS" ? "ILS" : "USD";
              const bucket = paymentMethodBucketKey(a.method);
              const amt =
                cur === "ILS"
                  ? Number(a.sourceAmount.toString())
                  : Number(a.amountUsd.toString());
              if (!Number.isFinite(amt) || amt <= 0) continue;
              let m = paidByOrderKey.get(p.orderId);
              if (!m) {
                m = new Map();
                paidByOrderKey.set(p.orderId, m);
              }
              const key = `${cur}:${bucket}`;
              m.set(key, roundMoney2((m.get(key) ?? 0) + amt));
            }
          }
          if (paidByOrderKey.size > 0) {
            for (const bal of balances) {
              const paid = paidByOrderKey.get(bal.orderId)?.get(`${bal.currency}:${bal.bucket}`) ?? 0;
              if (paid <= ALLOC_EPS) continue;
              bal.paid = paid;
              bal.remaining = roundMoney2(Math.max(0, bal.planned - paid));
              bal.status =
                bal.remaining <= ALLOC_EPS ? "paid" : paid > ALLOC_EPS ? "partial" : "open";
            }
          }
        }

        openMethodRemainingUsd = roundMoney2(
          balances
            .filter((b) => b.currency === "USD" && b.remaining > ALLOC_EPS)
            .reduce((s, b) => s + b.remaining, 0),
        );

        const orderIdsOldestFirst = [...candidateIds].sort((a, b) => {
          const oa = candidateOrders.find((o) => o.id === a);
          const ob = candidateOrders.find((o) => o.id === b);
          return (oa?.dateYmd ?? "").localeCompare(ob?.dateYmd ?? "");
        });

        matchingResult = applyDualCurrencyMatching({
          balances,
          enteredByBucket: enteredMethods,
          orderIdsOldestFirst,
          rateByOrderId: orderRate,
          // אין העברת חוב בין אמצעים בזמן קליטה
          debtTransfers: null,
        });

        allocationEntries = [...matchingResult.amountUsdByOrderId.entries()]
          .filter(([, amountUsd]) => amountUsd > ALLOC_EPS)
          .map(([orderId, amountUsd]) => [orderId, amountUsd] as [string, number]);
        // עודף לטיפול משתמש: כרגע מסלול העודף הקיים ב-USD (ILS נשמר בנפרד ב-matchingResult)
        unallocatedUsd = matchingResult.surplusUsd;

        logPaymentAllocationPreSave({
          source: "payment-save-matching-engine",
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

        /**
         * Matching ריק + חוב Ledger פתוח + אין יתרת אמצעי פתוחה
         * (snapshot ישן/לא מסונכרן) → FIFO לפי Ledger.
         * אם יש יתרת אמצעי פתוחה והתשלום לא פגע בה — זו אי-התאמת אמצעי, לא "כבר שולם".
         */
        if (allocationEntries.length === 0) {
          const ledgerOpenUsd = roundMoney2(
            bases.reduce((s, b) => s + Math.max(0, orderLedgerBalanceUsd(b)), 0),
          );
          if (ledgerOpenUsd > ALLOC_EPS && openMethodRemainingUsd <= ALLOC_EPS) {
            usedMethodMatching = false;
            matchingResult = null;
            const fifoDiag = logPaymentAllocationPreSave({
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
            unallocatedUsd = fifoDiag.unallocatedUsd;
            allocationEntries = fifoDiag.allocationTargets.map(
              (t) => [t.orderId, t.amountUsd] as [string, number],
            );
          }
        }
      } else {
        // מסמכים ללא תכנון אמצעים — FIFO הזמנות קלאסי
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
        allocationEntries = allocDiag.allocationTargets.map(
          (t) => [t.orderId, t.amountUsd] as [string, number],
        );
      }
    }
    const canSaveWithoutAllocTarget =
      (surplusAsCredit && unallocatedUsd > ALLOC_EPS) ||
      (surplusToCommission && unallocatedUsd > ALLOC_EPS) ||
      (surplusForfeit && unallocatedUsd > ALLOC_EPS);
    if (allocationEntries.length === 0 && !canSaveWithoutAllocTarget) {
      const ledgerOpenUsd = roundMoney2(
        bases.reduce((s, b) => s + Math.max(0, orderLedgerBalanceUsd(b)), 0),
      );
      console.error("[payment-save] Matching/FIFO returned no allocation targets", {
        customerId: cid,
        ordersCount: orders.length,
        basesCount: bases.length,
        paymentAmountUsd: totals.totalUsd,
        weekCode,
        includedOrderIds: form.includedOrderIds,
        prioritized: prioritized ? [...prioritized] : null,
        ledgerOpenUsd,
        openMethodRemainingUsd,
        usedMethodMatching,
        matchingSurplusUsd: matchingResult?.surplusUsd ?? null,
      });
      if (orders.length === 0) {
        return { ok: false, error: "לא נמצאו הזמנות ללקוח זה — לא ניתן לבצע הקצאה" };
      }
      if (ledgerOpenUsd > ALLOC_EPS) {
        // לקוח 105 ודומים: יש חוב Ledger אך Matching לא הקצה (אמצעי נעול/לא תואם)
        return {
          ok: false,
          error:
            openMethodRemainingUsd > ALLOC_EPS
              ? "קיימת יתרת חוב פתוחה, אך לא באמצעי התשלום שנבחר. יש לשלם לפי האמצעי המתוכנן, או לעדכן את האמצעים במסך «אמצעי תשלום מתוכננים» לפני הקליטה."
              : "קיימת יתרת חוב פתוחה בהזמנה, אך לא ניתן להקצות את התשלום לאמצעי המתוכננים. רעננו את המסך או בדקו את חלוקת האמצעים בהזמנה.",
        };
      }
      return {
        ok: false,
        error: "לא נמצאו הזמנות עם יתרת חוב פתוחה — ייתכן שהמסמך כבר שולם במלואו",
      };
    }
    if (
      unallocatedUsd > ALLOC_EPS &&
      !surplusAsCredit &&
      !surplusToCommission &&
      !surplusForfeit &&
      !form.applyCustomerBalanceReset &&
      !form.applyCustomerBalanceResetFromCredit
    ) {
      return {
        ok: false,
        error: `התשלום גבוה מהחוב ב-$${unallocatedUsd.toFixed(2)} — בחרו «יתרת זכות», «הכנסה נוספת» או «ויתור על העודף»`,
      };
    }

    /**
     * עודף:
     * commission → PaymentAdjustmentFee
     * forfeit → הוספה לעמלת ההזמנה (ExistingFees + Waived)
     * credit → יתרת זכות
     */
    if (surplusToCommission && unallocatedUsd > ALLOC_EPS) {
      surplusFeeUsd = roundMoney2(unallocatedUsd);
      unallocatedUsd = 0;
    } else if (surplusForfeit && unallocatedUsd > ALLOC_EPS) {
      forfeitToCommissionUsd = roundMoney2(unallocatedUsd);
      forfeitCommissionOrderId = resolveForfeitOrderId();
      unallocatedUsd = 0;
    } else if (
      form.applyCustomerBalanceReset &&
      !form.applyCustomerBalanceResetFromCredit &&
      unallocatedUsd > ALLOC_EPS &&
      allocationEntries.length > 0
    ) {
      const lastIdx = allocationEntries.length - 1;
      const [orderId, allocUsd] = allocationEntries[lastIdx]!;
      allocationEntries[lastIdx] = [orderId, roundMoney2(allocUsd + unallocatedUsd)];
      unallocatedUsd = 0;
    }
  } else {
    return { ok: false, error: "סכום התשלום בדולר חייב להיות גדול מאפס — בדקו את הסכום ואת שער הדולר" };
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
    const usdMethod = n.usdPaymentMethod ?? n.paymentMethod ?? "CASH";
    const ilsMethod = n.ilsPaymentMethod ?? n.paymentMethod ?? "CASH";
    if (c.usd.hasAmount) {
      parts.push(
        `USD $${c.usd.finalAmount.toFixed(2)} · ${usdMethod}`,
        `usdBase=$${c.usd.baseAmount.toFixed(2)} usdVat=$${c.usd.vatAmount.toFixed(2)}`,
      );
    }
    if (c.finalIls > 0) {
      parts.push(
        `ILS ₪${c.finalIls.toFixed(2)} · ${ilsMethod}`,
        `ilsBase=₪${c.ils.baseAmount.toFixed(2)} ilsVat=₪${c.ils.vatAmount.toFixed(2)}`,
        `ilsToUsd=$${c.convertedIlsUsd.toFixed(2)} @ ${rateN.toFixed(4)}`,
      );
    }
    const noteT = (n.note ?? n.usdNote ?? n.ilsNote ?? "").trim();
    if (noteT) parts.push(`note=${noteT}`);
    parts.push(`vatMode=${n.vatMode}`);
    return parts.join(" | ");
  });
  const structuredMethodAllocations = form.payments.flatMap((raw) => {
    const line = normalizePaymentLine(raw);
    const calc = calculatePaymentLine(line, rateN, VAT_RATE);
    const rows: Array<{
      method: string;
      currency: "USD" | "ILS";
      sourceAmount: Prisma.Decimal;
      amountUsd: Prisma.Decimal;
    }> = [];
    if (calc.usd.hasAmount) {
      rows.push({
        method: String(mapMethodToPrismaFromLine(line.usdPaymentMethod ?? line.paymentMethod)),
        currency: "USD",
        sourceAmount: new Prisma.Decimal(calc.usd.finalAmount.toFixed(4)),
        amountUsd: new Prisma.Decimal(calc.usd.finalAmount.toFixed(4)),
      });
    }
    if (calc.finalIls > ALLOC_EPS) {
      rows.push({
        method: String(mapMethodToPrismaFromLine(line.ilsPaymentMethod ?? line.paymentMethod)),
        currency: "ILS",
        sourceAmount: new Prisma.Decimal(calc.finalIls.toFixed(4)),
        amountUsd: new Prisma.Decimal(calc.convertedIlsUsd.toFixed(4)),
      });
    }
    return rows;
  });

  const commissionPctLine =
    commissionPctDec.gt(0) ? `אחוז עמלה כללי: ${commissionPctDec.toFixed(2)}%` : null;

  const combinedNotes = [
    "קליטת תשלום מעודכן (דו-מטבעי)",
    lineNotes ? `הערה: ${lineNotes}` : null,
    `totalPaymentUsd: $${totals.totalUsd.toFixed(2)}`,
    surplusCommissionAbsorbedUsd > ALLOC_EPS
      ? `${PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL}: $${surplusCommissionAbsorbedUsd.toFixed(2)}`
      : null,
    surplusFeeUsd > ALLOC_EPS
      ? `${PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL}: $${surplusFeeUsd.toFixed(2)}`
      : null,
    forfeitToCommissionUsd > ALLOC_EPS
      ? `ויתור על עודף → עמלה: $${forfeitToCommissionUsd.toFixed(2)}`
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

  /** רישומי Audit — נאספים בתוך ה-transaction */
  const pendingAudits: Prisma.AuditLogCreateManyInput[] = [];

  const allocOrderIds = [...new Set(allocationEntries.map(([id]) => id))];
  const closureBefore = allocOrderIds.length > 0 ? await loadOrderClosureSnapshot(allocOrderIds) : [];
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

  const forfeitOrderPrefetch =
    forfeitCommissionOrderId && forfeitToCommissionUsd > ALLOC_EPS
      ? await prisma.order.findFirst({
          where: { id: forfeitCommissionOrderId, customerId: cid, deletedAt: null },
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

  let balanceResetAudits: Prisma.AuditLogCreateManyInput[] = [];

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
            intakeDate,
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

        // אין תיעוד חריגת אמצעי תשלום — הקליטה שומרת את מה שהתקבל בפועל בלבד.

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
            intakeDate,
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
            businessType: "CUSTOMER_CREDIT",
            notes: creditNotes,
            createdById: me.id,
          },
        });
        savedCount += 1;
      }

      if (surplusFeeUsd > ALLOC_EPS) {
        const allocatedOrderIds = allocationEntries.map(([id]) => id);
        type SurplusEntry = { dbMethod: string; label: string; surplusUsd: number };
        const computedSurplus = computePerMethodSurplus({
          orders: intakeOrdersResult.orders,
          includedOrderIds: allocatedOrderIds,
          enteredByBucket: enteredMethodsUsdCompat,
          eps: ALLOC_EPS,
        });
        const computedTotal = roundMoney2(
          computedSurplus.reduce((sum, entry) => sum + entry.surplusUsd, 0),
        );
        const surplusEntries: SurplusEntry[] =
          computedSurplus.length > 0 && Math.abs(computedTotal - surplusFeeUsd) <= 0.05
            ? computedSurplus.map(({ dbMethod, label, surplusUsd }) => ({
                dbMethod,
                label,
                surplusUsd,
              }))
            : [
                {
                  dbMethod: String(payMethodDb),
                  label: PAYMENT_METHOD_LABELS[String(payMethodDb)] ?? String(payMethodDb),
                  surplusUsd: surplusFeeUsd,
                },
              ];

        // Source order/document (last allocated order, or primary code)
        const sourceOrderId =
          allocationEntries.length > 0 ? allocationEntries[allocationEntries.length - 1][0] : null;
        const sourceOrder = sourceOrderId ? allocOrdersById.get(sourceOrderId) : null;
        const sourceDocumentCode = sourceOrder?.orderNumber ?? primaryCode;

        // Create ONE summary Payment row for the total surplus amount
        const feeUsd = new Prisma.Decimal(surplusFeeUsd.toFixed(4));
        const feeTotals = computeFromUsdAmount(feeUsd, {
          baseDollarRate: base,
          dollarFee: fee,
          finalDollarRate: finalUse,
          vatRate,
        });
        const methodSummary = surplusEntries.length > 1
          ? surplusEntries.map((e) => `${e.label} $${e.surplusUsd.toFixed(2)}`).join(" · ")
          : null;
        const feeNotes = [
          PAYMENT_ADJUSTMENT_FEE_NOTE_PREFIX,
          `קשור לקליטה ${primaryCode}`,
          sourceDocumentCode ? `מסמך מקור: ${sourceDocumentCode}` : null,
          `עודף: $${surplusFeeUsd.toFixed(2)}`,
          methodSummary ? `לפי אמצעי: ${methodSummary}` : null,
          PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL,
        ]
          .filter(Boolean)
          .join("\n");
        const feePaymentCode = allocIndex === 0 ? primaryCode : null;
        const createdFeePayment = await tx.payment.create({
          data: {
            countryCode: payWorkCountry,
            paymentCode: feePaymentCode,
            paymentNumber: allocated.paymentNumber,
            orderId: null,
            customerId: cid,
            weekCode,
            paymentDate,
            intakeDate,
            paymentPlace: null,
            currency: "USD",
            amountUsd: feeUsd,
            amountIls: null,
            sourceCurrency: "USD",
            sourceAmount: feeUsd,
            exchangeRate: finalUse,
            vatRate,
            commissionPercent: commissionPctDec,
            amountWithoutVat: feeTotals.totalIlsWithoutVat,
            snapshotBaseDollarRate: feeTotals.snapshotBaseDollarRate,
            snapshotDollarFee: feeTotals.snapshotDollarFee,
            snapshotFinalDollarRate: feeTotals.snapshotFinalDollarRate,
            totalIlsWithVat: feeTotals.totalIlsWithVat,
            totalIlsWithoutVat: feeTotals.totalIlsWithoutVat,
            vatAmount: feeTotals.vatAmount,
            manualDateChanged,
            paymentMethod: payMethodDb,
            usdPaymentMethod: usdMethod,
            ilsPaymentMethod: ilsMethod,
            usdNote: null,
            ilsNote: null,
            isPaid: true,
            businessType: "ADJUSTMENT_FEE",
            notes: feeNotes,
            createdById: me.id,
          },
        });
        if (!primaryPaymentId) primaryPaymentId = createdFeePayment.id;
        savedCount += 1;

        // Create ONE PaymentAdjustmentFee per payment-method that has a surplus.
        // This provides full per-method auditability as requested.
        for (const entry of surplusEntries) {
          const entryUsd = new Prisma.Decimal(entry.surplusUsd.toFixed(4));
          const entryTotals = surplusEntries.length === 1
            ? feeTotals
            : computeFromUsdAmount(entryUsd, { baseDollarRate: base, dollarFee: fee, finalDollarRate: finalUse, vatRate });

          const feeRow = await tx.paymentAdjustmentFee.create({
            data: buildPaymentAdjustmentFeeCreateData({
              customerId: cid,
              orderId: sourceOrderId,
              paymentId: createdFeePayment.id,
              paymentCaptureCode: primaryCode,
              sourceDocumentCode,
              paymentMethod: entry.dbMethod,
              amountUsd: entryUsd,
              amountIls: entryTotals.totalIlsWithVat,
              reason: "PAYMENT_SURPLUS",
              status: "OPEN",
              notes: `עודף מתשלום · אמצעי: ${entry.label} · בחירת משתמש: הוסף לעמלות`,
              userChoice: "commission",
              createdById: me.id,
            }),
          });

          pendingAudits.push({
            userId: me.id,
            actionType: "PAYMENT_SURPLUS_TO_COMMISSION",
            entityType: "PaymentAdjustmentFee",
            entityId: feeRow.id,
            oldValue: Prisma.JsonNull,
            newValue: {
              amountUsd: entryUsd.toFixed(2),
              status: "OPEN",
              reason: "PAYMENT_SURPLUS",
            } as Prisma.InputJsonValue,
            metadata: {
              customerId: cid,
              paymentId: createdFeePayment.id,
              paymentCaptureCode: primaryCode,
              sourceDocumentCode,
              orderId: sourceOrderId,
              paymentMethod: entry.dbMethod,
              surplusUsd: entry.surplusUsd.toFixed(2),
              totalSurplusUsd: surplusFeeUsd.toFixed(2),
              perMethodCount: surplusEntries.length,
              userChoice: "commission",
              ledgerLabel: PAYMENT_SURPLUS_TO_COMMISSION_LEDGER_LABEL,
            } as Prisma.InputJsonValue,
          });
        }
      }

      if (primaryPaymentId && structuredMethodAllocations.length > 0) {
        await tx.paymentMethodAllocation.createMany({
          data: structuredMethodAllocations.map((row) => ({
            paymentId: primaryPaymentId!,
            ...row,
          })),
        });
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

      // Matching Engine → Persist SSOT במטבע המקורי של כל שורה
      if (matchingResult) {
        for (const bal of matchingResult.balances) {
          const paidDec = new Prisma.Decimal(bal.paid.toFixed(4));
          const remDec = new Prisma.Decimal(Math.max(0, bal.remaining).toFixed(4));
          if (bal.breakdownId) {
            await tx.orderPaymentBreakdown.update({
              where: { id: bal.breakdownId },
              data: { paidAmount: paidDec, remainingAmount: remDec },
            });
          } else {
            await tx.orderPaymentBreakdown.create({
              data: {
                orderId: bal.orderId,
                paymentMethod: bal.method,
                amount: new Prisma.Decimal(Math.max(0, bal.planned).toFixed(4)),
                currency: bal.currency,
                paidAmount: paidDec,
                remainingAmount: remDec,
              },
            });
          }
        }
        if (matchingResult.transfersApplied.length > 0) {
          pendingAudits.push({
            userId: me.id,
            actionType: "PAYMENT_METHOD_DEBT_TRANSFER",
            entityType: "OrderPaymentBreakdown",
            entityId: matchingResult.transfersApplied[0]!.orderId ?? cid,
            oldValue: Prisma.JsonNull,
            newValue: {
              transfers: matchingResult.transfersApplied.map((t) => ({
                fromBucket: t.fromBucket,
                toBucket: t.toBucket,
                amountUsd: t.amount,
                orderId: t.orderId ?? null,
                currency: t.currency,
              })),
            } as Prisma.InputJsonValue,
            metadata: {
              customerId: cid,
              paymentCaptureCode: primaryCode,
              transferCount: matchingResult.transfersApplied.length,
              surplusUsd: matchingResult.surplusUsd,
              surplusIls: matchingResult.surplusIls,
            } as Prisma.InputJsonValue,
          });
        }
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

      // ויתור על עודף → עמלה חדשה = עמלה קיימת + סכום הוויתור
      if (forfeitOrderPrefetch && forfeitToCommissionUsd > ALLOC_EPS) {
        const forfeitOrder = forfeitOrderPrefetch;
        const deal = forfeitOrder.amountUsd ?? new Prisma.Decimal(0);
        const oldCom = forfeitOrder.commissionUsd ?? new Prisma.Decimal(0);
        const oldTotal = forfeitOrder.totalUsd ?? deal.add(oldCom).toDecimalPlaces(4, 4);
        const waivedDec = new Prisma.Decimal(forfeitToCommissionUsd.toFixed(4));
        const plan = planCommissionSurplusAbsorption({
          commissionUsd: oldCom,
          totalUsd: oldTotal,
          surplusUsd: waivedDec,
        });
        await tx.order.update({
          where: { id: forfeitOrder.id },
          data: {
            commissionUsd: plan.afterCommissionUsd,
            totalUsd: plan.afterTotalUsd,
          },
        });
        pendingAudits.push({
          userId: me.id,
          actionType: "PAYMENT_SURPLUS_FORFEIT_TO_COMMISSION",
          entityType: "Order",
          entityId: forfeitOrder.id,
          oldValue: {
            commissionUsd: plan.beforeCommissionUsd.toString(),
            totalUsd: plan.beforeTotalUsd.toString(),
          } as Prisma.InputJsonValue,
          newValue: {
            commissionUsd: plan.afterCommissionUsd.toString(),
            totalUsd: plan.afterTotalUsd.toString(),
          } as Prisma.InputJsonValue,
          metadata: {
            orderNumber: forfeitOrder.orderNumber ?? null,
            paymentCaptureCode: primaryCode,
            waivedUsd: forfeitToCommissionUsd.toFixed(2),
            userChoice: "forfeit",
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
          await closePaymentPlansForOrdersInTx(tx, {
            orderIds: commissionResetOrdersPrefetch.map((o) => o.id),
            closureType: "BALANCE_RESET",
            userId: me.id,
            weekCode,
            reason: "סגירת חוב באמצעות עמלה",
          });
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
          intakeDate,
          manualDateChanged,
        });
        balanceResetAudits = [resetResult.auditEntry];
        savedCount += resetResult.paymentCount;
      } else if (form.applyCustomerBalanceReset) {
        const resetResult = await applyCustomerOutstandingBalanceResetInTx(tx, {
          customerId: cid,
          weekCode,
          userId: me.id,
          paymentCaptureContext: {
            primaryPaymentCode: primaryCode,
            paymentNumber: allocated.paymentNumber,
          },
        });
        balanceResetAudits = resetResult.auditEntries;
      }

      const auditBatch = [...pendingAudits, ...balanceResetAudits];
      if (auditBatch.length > 0) {
        await tx.auditLog.createMany({ data: auditBatch });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שמירה נכשלה";
    return { ok: false, error: msg };
  }

  // תיעוד Recalculate (Audit) — לפני/אחרי, בלי שינוי נתונים קיימים.
  // מטרת הרישום: שקיפות מלאה למה קרה למסמכים בעקבות FIFO והסגירה.
  try {
    if (allocOrderIds.length > 0) {
      const closureAfter = await loadOrderClosureSnapshot(allocOrderIds);
      const beforeById = new Map(closureBefore.map((r) => [r.orderId, r]));
      const afterById = new Map(closureAfter.map((r) => [r.orderId, r]));
      const audits: Prisma.AuditLogCreateManyInput[] = [];

      const EPS = 0.009;
      for (const oid of allocOrderIds) {
        const b = beforeById.get(oid) ?? null;
        const a = afterById.get(oid) ?? null;
        if (!a) continue;
        if (
          b &&
          Math.abs(b.paidUsd - a.paidUsd) <= EPS &&
          Math.abs(b.remainingUsd - a.remainingUsd) <= EPS &&
          b.status === a.status
        ) {
          continue;
        }
        audits.push({
          userId: me.id,
          actionType: "PAYMENT_CLOSURE_RECALC",
          entityType: "Order",
          entityId: oid,
          oldValue: b
            ? ({
                paidUsd: b.paidUsd.toFixed(2),
                remainingUsd: b.remainingUsd.toFixed(2),
                status: b.status,
              } satisfies Prisma.InputJsonValue)
            : Prisma.JsonNull,
          newValue: {
            paidUsd: a.paidUsd.toFixed(2),
            remainingUsd: a.remainingUsd.toFixed(2),
            status: a.status,
          } satisfies Prisma.InputJsonValue,
          metadata: {
            orderNumber: a.orderNumber,
            totalUsd: a.totalUsd.toFixed(2),
            customerId: cid,
            paymentCaptureCode: primaryCode,
            paymentNumber: allocated.paymentNumber,
            weekCode: weekCode ?? null,
            workCountry: payWorkCountry,
            at: new Date().toISOString(),
          } satisfies Prisma.InputJsonValue,
        });
      }

      if (audits.length > 0) {
        await prisma.auditLog.createMany({ data: audits });
      }
    }
  } catch {
    // Audit is best-effort; never block payment save completion.
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
      const calc = calculateBalanceReset({
        totalBeforeUsd: Number(totalOrd),
        paidUsd: Number(paid),
        commissionBeforeUsd: Number(com),
      });
      if (calc.adjustmentType === "EXACT") {
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

      const payload = buildOrderBalanceResetAuditPayload({
        orderId: oid,
        customerId: target.customerId!,
        orderNumber: target.orderNumber,
        calc,
        totalBeforeUsd: Number(totalOrd),
        paidUsd: Number(paid),
        commissionBeforeUsd: Number(com),
      });
      const performedAt = new Date().toISOString();

      await tx.auditLog.create({
        data: {
          userId: me.id,
          actionType: payload.actionType,
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
            ...payload,
            orderNumber: target.orderNumber ?? null,
            resetUsd: plan.remainingUsd.toString(),
            ledgerLabel: balanceResetLedgerLabel(calc.adjustmentType),
            beforeRemainingUsd: plan.remainingUsd.toString(),
            afterRemainingUsd: "0",
            performedBy: me.id,
            performedAt,
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
    intakeDate: Date;
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
        intakeDate: params.intakeDate,
        currency: "USD",
        amountUsd: row.remainingUsd,
        sourceCurrency: "USD",
        sourceAmount: row.remainingUsd,
        manualDateChanged: params.manualDateChanged,
        paymentMethod: PaymentMethod.OTHER,
        usdPaymentMethod: PaymentMethod.OTHER,
        isPaid: true,
        businessType: "CREDIT_APPLICATION",
        notes,
        createdById: params.userId,
      },
    });
  }

  const closedIds = toClose.map((x) => x.orderId);

  await closePaymentPlansForOrdersInTx(tx, {
    orderIds: closedIds,
    closureType: "CREDIT_BALANCE",
    userId: params.userId,
    weekCode: params.weekCode,
    reason: "איפוס מתוך יתרת זכות",
  });

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

/** ביטול יתרת זכות מעודף מאותה קליטת תשלום בלבד — מניעת כפילות מול העברה לעמלה */
async function cancelOverpaymentCreditsFromCaptureInTx(
  tx: Prisma.TransactionClient,
  params: {
    customerId: string;
    paymentNumber: number;
    overpaymentUsd: Prisma.Decimal;
  },
): Promise<Prisma.Decimal> {
  const EPS = new Prisma.Decimal(String(BALANCE_RESET_TOLERANCE_USD));
  if (params.overpaymentUsd.lte(EPS)) return new Prisma.Decimal(0);

  const credits = await tx.payment.findMany({
    where: {
      customerId: params.customerId,
      orderId: null,
      paymentNumber: params.paymentNumber,
      ...activePaidPaymentWhere,
      businessType: "CUSTOMER_CREDIT",
    },
    select: { id: true, amountUsd: true, notes: true, paymentNumber: true, orderId: true },
  });

  const ids = pickOverpaymentCreditsToCancel({
    overpaymentUsd: Number(params.overpaymentUsd),
    paymentNumber: params.paymentNumber,
    candidates: credits
      .filter((c) => c.paymentNumber != null)
      .map((c) => ({
        id: c.id,
        amountUsd: Number(c.amountUsd ?? 0),
        paymentNumber: c.paymentNumber!,
        orderId: c.orderId,
      })),
  });

  let removed = new Prisma.Decimal(0);
  for (const id of ids) {
    const row = credits.find((c) => c.id === id);
    if (!row) continue;
    const amt = row.amountUsd ?? new Prisma.Decimal(0);
    await tx.payment.update({
      where: { id },
      data: {
        status: PAYMENT_RECORD_STATUS_CANCELLED,
        notes: `${row.notes ?? ""}\n[בוטל — עודף הועבר לעמלה באיפוס יתרה]`.trim(),
      },
    });
    removed = removed.add(amt);
  }
  return removed.toDecimalPlaces(2, 4);
}

/** איפוס יתרה לכל הזמנות פתוחות של לקוח — בתוך transaction קיימת */
async function applyCustomerOutstandingBalanceResetInTx(
  tx: Prisma.TransactionClient,
  params: {
    customerId: string;
    weekCode: string | null;
    userId: string;
    orderIds?: string[] | null;
    /** false = מותר לקזז רק עד אפס; אין ליצור עמלה שלילית. */
    allowNegativeCommission?: boolean;
    paymentCaptureContext?: {
      primaryPaymentCode: string;
      paymentNumber: number;
    };
  },
): Promise<{
  totalResetUsd: string;
  closedOrderIds: string[];
  affectedOrderUpdates: { orderId: string; newCommissionUsd: string; newTotalUsd: string }[];
  auditEntries: Prisma.AuditLogCreateManyInput[];
}> {
  const cid = params.customerId;
  const weekCode = params.weekCode?.trim() || null;
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(weekCode);

  const orders = await tx.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      ...(weekDateWhere ?? {}),
      ...(params.orderIds && params.orderIds.length > 0
        ? { id: { in: params.orderIds } }
        : {}),
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
    totalBeforeUsd: Prisma.Decimal;
    commissionBeforeUsd: Prisma.Decimal;
    calc: ReturnType<typeof calculateBalanceReset>;
    overpaymentCreditRemovedUsd: Prisma.Decimal;
  }> = [];

  for (const o of orders) {
    const amount = o.amountUsd ?? new Prisma.Decimal(0);
    const commissionStored = o.commissionUsd ?? new Prisma.Decimal(0);
    const total = o.totalUsd ?? amount.add(commissionStored).toDecimalPlaces(4, 4);
    const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
    const calc = calculateBalanceReset({
      totalBeforeUsd: Number(total),
      paidUsd: Number(paid),
      commissionBeforeUsd: Number(commissionStored),
    });
    if (calc.adjustmentType === "EXACT") continue;

    if (
      !isBalanceResetStillApplicable(
        Number(total),
        Number(paid),
        calc.balanceBeforeUsd,
      )
    ) {
      throw new Error("נתוני ההזמנה השתנו — אין יתרה לאיפוס");
    }

    const plan = planOrderBalanceReset({
      amountUsd: amount,
      commissionUsd: commissionStored,
      totalUsd: total,
      paidUsd: paid,
    });

    let overpaymentCreditRemovedUsd = new Prisma.Decimal(0);
    if (
      calc.adjustmentType === "OVERPAYMENT" &&
      params.paymentCaptureContext &&
      calc.differenceUsd > BALANCE_RESET_TOLERANCE_USD
    ) {
      overpaymentCreditRemovedUsd = await cancelOverpaymentCreditsFromCaptureInTx(tx, {
        customerId: cid,
        paymentNumber: params.paymentCaptureContext.paymentNumber,
        overpaymentUsd: new Prisma.Decimal(calc.differenceUsd.toFixed(4)),
      });
    }

    orderResets.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      amountUsd: amount,
      paidUsd: paid,
      totalBeforeUsd: total,
      commissionBeforeUsd: commissionStored,
      plan,
      calc,
      overpaymentCreditRemovedUsd,
    });
  }

  if (orderResets.length === 0) {
    throw new Error("אין יתרה פתוחה לאיפוס");
  }

  if (
    params.allowNegativeCommission === false &&
    orderResets.some((row) => Number(row.plan.afterCommissionUsd) < -BALANCE_RESET_TOLERANCE_USD)
  ) {
    throw new Error(
      "אין מספיק עמלות לסגירת החוב. נדרש אישור נפרד ליצירת עמלה שלילית.",
    );
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
  await closePaymentPlansForOrdersInTx(tx, {
    orderIds: closedIds,
    closureType: "BALANCE_RESET",
    userId: params.userId,
    weekCode: params.weekCode,
    reason: "איפוס יתרה",
  });

  const performedAt = new Date().toISOString();
  const auditEntries: Prisma.AuditLogCreateManyInput[] = [];

  for (const row of orderResets) {
    const payload = buildOrderBalanceResetAuditPayload({
      orderId: row.orderId,
      customerId: cid,
      orderNumber: row.orderNumber,
      calc: row.calc,
      totalBeforeUsd: Number(row.totalBeforeUsd),
      paidUsd: Number(row.paidUsd),
      commissionBeforeUsd: Number(row.commissionBeforeUsd),
      overpaymentCreditRemovedUsd: Number(row.overpaymentCreditRemovedUsd),
      paymentPrimaryCode: params.paymentCaptureContext?.primaryPaymentCode ?? null,
    });

    auditEntries.push({
      userId: params.userId,
      actionType: payload.actionType,
      entityType: "Order",
      entityId: row.orderId,
      oldValue: {
        amountUsd: row.amountUsd.toString(),
        commissionUsd: row.commissionBeforeUsd.toString(),
        totalUsd: row.totalBeforeUsd.toString(),
        paidUsd: row.paidUsd.toString(),
        remainingUsd: row.plan.remainingUsd.toString(),
      } as Prisma.InputJsonValue,
      newValue: {
        amountUsd: row.amountUsd.toString(),
        commissionUsd: row.plan.afterCommissionUsd.toString(),
        totalUsd: row.plan.afterTotalUsd.toString(),
        status: OS.COMPLETED,
        remainingUsd: "0",
      } as Prisma.InputJsonValue,
      metadata: {
        ...payload,
        orderNumber: row.orderNumber ?? null,
        ledgerLabel: balanceResetLedgerLabel(row.calc.adjustmentType),
        performedBy: params.userId,
        performedAt,
      } as Prisma.InputJsonValue,
    });
  }

  auditEntries.push({
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
        differenceUsd: x.calc.differenceUsd.toFixed(2),
        adjustmentType: x.calc.adjustmentType,
        beforeCommissionUsd: x.plan.beforeCommissionUsd.toString(),
        afterCommissionUsd: x.plan.afterCommissionUsd.toString(),
        beforeTotalUsd: x.plan.beforeTotalUsd.toString(),
        afterTotalUsd: x.plan.afterTotalUsd.toString(),
        balanceBeforeUsd: x.calc.balanceBeforeUsd.toFixed(2),
        balanceAfterUsd: x.calc.balanceAfterUsd.toFixed(2),
        amountUsd: x.amountUsd.toString(),
        paidUsd: x.paidUsd.toString(),
        overpaymentCreditRemovedUsd: x.overpaymentCreditRemovedUsd.toFixed(2),
        ledgerLabel: balanceResetLedgerLabel(x.calc.adjustmentType),
      })),
      totalResetUsd: totalRemaining.toString(),
      performedBy: params.userId,
      performedAt,
    } as Prisma.InputJsonValue,
  });

  return {
    totalResetUsd: totalRemaining.toFixed(2),
    closedOrderIds: closedIds,
    affectedOrderUpdates: orderResets.map((x) => ({
      orderId: x.orderId,
      newCommissionUsd: x.plan.afterCommissionUsd.toFixed(2),
      newTotalUsd: x.plan.afterTotalUsd.toFixed(2),
    })),
    auditEntries,
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
  /** מגביל את הפעולה למסמכים שהוצגו בסיכום התשלום. */
  orderIds?: string[] | null;
  /** נשלח רק מחלון הסיכום לאחר שמירת התשלום. */
  allowNegativeCommission?: boolean;
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
  const allowNegativeCommission = Boolean(input.allowNegativeCommission);
  if (allowNegativeCommission && !isAdminUser(me)) {
    return { ok: false, error: "אין הרשאת מנהל לאישור עמלה שלילית" };
  }
  if (!isAdminUser(me) && !userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה לקיזוז יתרה מעמלות" };
  }

  const cid = (input.customerId || "").trim();
  if (!cid) return { ok: false, error: "חסר מזהה לקוח" };

  const weekCode = input.weekCode?.trim() || null;
  const orderIds = (input.orderIds ?? []).map((id) => id.trim()).filter(Boolean);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const resetResult = await applyCustomerOutstandingBalanceResetInTx(tx, {
        customerId: cid,
        weekCode,
        userId: me.id,
        orderIds,
        allowNegativeCommission,
      });
      await tx.auditLog.createMany({ data: resetResult.auditEntries });
      return resetResult;
    });

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

/**
 * תיקון נתונים בטוח: החלת "יתרת זכות" קיימת (תשלומי credit עם orderId=null)
 * על הזמנות פתוחות של אותו לקוח, FIFO, בלי למחוק נתונים.
 *
 * מבצע:
 * - ביטול שורות credit קיימות (status=CANCELLED) במקום למחוק/לערוך סכומים
 * - יצירת שורות Payment חדשות שמוקצות להזמנה (orderId=...)
 * - אם שורת credit גדולה מהנדרש: מפצלים (cancel מקור + create allocated + create credit remainder)
 *
 * חשוב: לא נוגע ב-FinanceEntry / PaymentAllocation (אין טבלה) ולא משנה schema.
 */
export async function applyCustomerCreditToOpenOrdersAction(input: {
  customerId: string;
  /** מגביל סכום שמוחל (אופציונלי) */
  maxUsd?: string | null;
  /** מגביל את ההחלה למסמכים שהוצגו בסיכום התשלום. */
  orderIds?: string[] | null;
}): Promise<
  | {
      ok: true;
      appliedUsd: string;
      cancelledCreditPayments: number;
      createdPayments: number;
      affectedOrderIds: string[];
    }
  | { ok: false; error: string }
> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה לשימוש ביתרת זכות" };
  }

  const cid = (input.customerId || "").trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };
  const requestedOrderIds = (input.orderIds ?? []).map((id) => id.trim()).filter(Boolean);

  let maxUsd: Prisma.Decimal | null = null;
  try {
    const raw = (input.maxUsd ?? "").trim();
    if (raw) maxUsd = new Prisma.Decimal(raw.replace(",", ".")).toDecimalPlaces(4, 4);
  } catch {
    return { ok: false, error: "maxUsd לא תקין" };
  }

  const EPS = new Prisma.Decimal("0.01");
  const now = new Date();
  const affectedOrderIds: string[] = [];
  let cancelledCreditPayments = 0;
  let createdPayments = 0;
  let appliedUsd = new Prisma.Decimal(0);

  try {
    await prisma.$transaction(async (tx) => {
      // 1) Open orders + paid sums
      const orders = await tx.order.findMany({
        where: {
          customerId: cid,
          deletedAt: null,
          status: { not: OS.DEBT_WITHDRAWAL },
          ...(requestedOrderIds.length > 0 ? { id: { in: requestedOrderIds } } : {}),
        },
        orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, orderNumber: true, amountUsd: true, commissionUsd: true, totalUsd: true, weekCode: true, countryCode: true },
      });
      if (orders.length === 0) throw new Error("אין הזמנות ללקוח");

      const orderIds = orders.map((o) => o.id);
      const paidAgg = await tx.payment.groupBy({
        by: ["orderId"],
        where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
        _sum: { amountUsd: true },
      });
      const paidByOrder = new Map<string, Prisma.Decimal>();
      for (const p of paidAgg) {
        if (p.orderId) paidByOrder.set(p.orderId, p._sum.amountUsd ?? new Prisma.Decimal(0));
      }

      const openOrders = orders
        .map((o) => {
          const deal = o.amountUsd ?? new Prisma.Decimal(0);
          const com = o.commissionUsd ?? new Prisma.Decimal(0);
          const total = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
          const paid = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
          const remaining = total.sub(paid).toDecimalPlaces(4, 4);
          return {
            orderId: o.id,
            orderNumber: o.orderNumber?.trim() || null,
            weekCode: o.weekCode?.trim() || null,
            countryCode: o.countryCode,
            remaining,
          };
        })
        .filter((o) => o.remaining.gt(EPS));

      if (openOrders.length === 0) throw new Error("אין יתרה פתוחה להזמנות");

      // 2) Credit payments candidates (created from overage flow)
      const credits = await tx.payment.findMany({
        where: {
          customerId: cid,
          orderId: null,
          businessType: "CUSTOMER_CREDIT",
          amountUsd: { not: null },
          ...activePaidPaymentWhere,
        },
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          paymentNumber: true,
          countryCode: true,
          weekCode: true,
          paymentDate: true,
          intakeDate: true,
          currency: true,
          amountUsd: true,
          amountIls: true,
          sourceCurrency: true,
          sourceAmount: true,
          exchangeRate: true,
          vatRate: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          notes: true,
          createdById: true,
        },
      });

      if (credits.length === 0) throw new Error("אין שורות יתרת זכות (קרדיט) זמינות");

      const audits: Prisma.AuditLogCreateManyInput[] = [];

      let creditIndex = 0;
      for (const ord of openOrders) {
        if (maxUsd && appliedUsd.gte(maxUsd.sub(EPS))) break;
        let remaining = ord.remaining;
        while (remaining.gt(EPS) && creditIndex < credits.length) {
          const c = credits[creditIndex]!;
          const creditAmt = c.amountUsd ?? new Prisma.Decimal(0);
          if (creditAmt.lte(EPS)) {
            creditIndex += 1;
            continue;
          }

          // amount to apply
          let take = remaining;
          if (take.gt(creditAmt)) take = creditAmt;
          if (maxUsd) {
            const left = maxUsd.sub(appliedUsd);
            if (left.lte(EPS)) break;
            if (take.gt(left)) take = left;
          }
          if (take.lte(EPS)) break;

          // cancel original credit row
          await tx.payment.update({
            where: { id: c.id },
            data: {
              status: PAYMENT_RECORD_STATUS_CANCELLED,
              cancelledAt: now,
              cancelledById: me.id,
              cancelReason: `Applied credit to order ${ord.orderNumber ?? ord.orderId}`,
            },
          });
          cancelledCreditPayments += 1;

          // create allocated payment row (new)
          const notes = [
            "קיזוז יתרת זכות לסגירת הזמנה",
            `מקור קרדיט: ${c.id}`,
            ord.orderNumber ? `הזמנה: ${ord.orderNumber}` : null,
            `סכום: $${take.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join("\n");

          await tx.payment.create({
            data: {
              countryCode: c.countryCode,
              paymentCode: null,
              paymentNumber: c.paymentNumber ?? null,
              orderId: ord.orderId,
              customerId: cid,
              weekCode: ord.weekCode ?? c.weekCode ?? null,
              paymentDate: c.paymentDate ?? now,
              intakeDate: c.intakeDate ?? c.paymentDate ?? now,
              currency: "USD",
              amountUsd: take,
              amountIls: null,
              sourceCurrency: "USD",
              sourceAmount: take,
              exchangeRate: c.exchangeRate,
              vatRate: c.vatRate ?? new Prisma.Decimal(VAT_RATE),
              manualDateChanged: false,
              paymentMethod: PaymentMethod.OTHER,
              usdPaymentMethod: PaymentMethod.OTHER,
              ilsPaymentMethod: null,
              usdNote: null,
              ilsNote: null,
              isPaid: true,
              businessType: "CREDIT_APPLICATION",
              notes,
              createdById: me.id,
            },
          });
          createdPayments += 1;
          appliedUsd = appliedUsd.add(take).toDecimalPlaces(4, 4);
          affectedOrderIds.push(ord.orderId);

          audits.push({
            userId: me.id,
            actionType: "CUSTOMER_CREDIT_APPLIED_TO_ORDER",
            entityType: "Payment",
            entityId: c.id,
            oldValue: { status: "ACTIVE", amountUsd: creditAmt.toFixed(2) } as Prisma.InputJsonValue,
            newValue: { status: "CANCELLED", appliedUsd: take.toFixed(2) } as Prisma.InputJsonValue,
            metadata: {
              customerId: cid,
              orderId: ord.orderId,
              orderNumber: ord.orderNumber,
              creditPaymentId: c.id,
              creditPaymentNumber: c.paymentNumber ?? null,
            } as Prisma.InputJsonValue,
          });

          // remainder credit -> create new credit row
          const remainder = creditAmt.sub(take).toDecimalPlaces(4, 4);
          if (remainder.gt(EPS)) {
            const remainderNotes = [
              CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX,
              "פיצול אחרי קיזוז יתרת זכות",
              `מקור: ${c.id}`,
              `יתרה: $${remainder.toFixed(2)}`,
            ].join("\n");
            await tx.payment.create({
              data: {
                countryCode: c.countryCode,
                paymentCode: null,
                paymentNumber: c.paymentNumber ?? null,
                orderId: null,
                customerId: cid,
                weekCode: c.weekCode ?? null,
                paymentDate: c.paymentDate ?? now,
                intakeDate: c.intakeDate ?? c.paymentDate ?? now,
                currency: "USD",
                amountUsd: remainder,
                amountIls: null,
                sourceCurrency: "USD",
                sourceAmount: remainder,
                exchangeRate: c.exchangeRate,
                vatRate: c.vatRate ?? new Prisma.Decimal(VAT_RATE),
                manualDateChanged: false,
                paymentMethod: c.paymentMethod ?? PaymentMethod.OTHER,
                usdPaymentMethod: c.usdPaymentMethod ?? PaymentMethod.OTHER,
                ilsPaymentMethod: c.ilsPaymentMethod ?? null,
                usdNote: null,
                ilsNote: null,
                isPaid: true,
              businessType: "CUSTOMER_CREDIT",
                notes: remainderNotes,
                createdById: me.id,
              },
            });
            createdPayments += 1;
          }

          remaining = remaining.sub(take).toDecimalPlaces(4, 4);
          creditIndex += 1;
        }
      }

      if (audits.length > 0) {
        await tx.auditLog.createMany({ data: audits });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "כשלון";
    return { ok: false, error: msg };
  }

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(cid);
  await persistCustomerBalanceSnapshot(cid, customerBalanceUsd);
  revalidateAllKpiCaches();
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/source-tables/payments");

  return {
    ok: true,
    appliedUsd: appliedUsd.toFixed(2),
    cancelledCreditPayments,
    createdPayments,
    affectedOrderIds: [...new Set(affectedOrderIds)],
  };
}
