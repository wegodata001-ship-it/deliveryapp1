import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  applyDebtWithdrawalToIntakeOrders,
  debtStatus,
  orderLedgerBalanceUsd,
  type OrderBreakdownMethodRow,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import { reconcileOrderBreakdownWithLedger } from "@/lib/order-remaining-debt";
import { computeOrderMethodDeviation, isCompositePaymentMethod, paymentMethodBucketKey } from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { loadPaymentPlanSummariesByOrderId } from "@/lib/payment-plan-service";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";
import { findActiveCustomerPayments, groupByActivePayments } from "@/lib/payment-record-status";
import { OS } from "@/lib/order-status-slugs";
import { orderCustomerCreditUsd } from "@/lib/debt-withdrawal-order";
import { computeOrderCommissionBreakdown } from "@/lib/order-commission-ssot";
import { isLegacyCommissionOrderMutationFee } from "@/lib/customer-commission-balance-shared";

export type PaymentIntakeCustomerPayload = {
  id: string;
  displayName: string;
  nameEn: string | null;
  nameHe: string | null;
  nameAr: string | null;
  phone: string | null;
  customerCode: string | null;
  customerIndex: string | null;
  customerBalanceUsd: string;
};

type IntakeLoadParams = {
  customerId: string;
  weekCodeForOpenBalances?: string | null;
  paymentWorkCountryRaw?: string | null;
};

const INTAKE_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  orderDate: true,
  weekCode: true,
  amountUsd: true,
  commissionUsd: true,
  totalUsd: true,
  exchangeRate: true,
  usdRateUsed: true,
  snapshotFinalDollarRate: true,
  totalIlsWithVat: true,
  totalIls: true,
  sourceCountry: true,
  paymentMethod: true,
  createdAt: true,
  paymentBreakdown: {
    select: {
      id: true,
      paymentMethod: true,
      amount: true,
      currency: true,
      paidAmount: true,
      remainingAmount: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.OrderSelect;

type IntakeOrderRecord = Prisma.OrderGetPayload<{ select: typeof INTAKE_ORDER_SELECT }>;

async function loadIntakeCustomerRecord(customerId: string) {
  return prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null, isActive: true },
    select: {
      id: true,
      displayName: true,
      nameEn: true,
      nameHe: true,
      nameAr: true,
      phone: true,
      customerCode: true,
      oldCustomerCode: true,
    },
  });
}

function customerPayloadFromRow(
  cust: NonNullable<Awaited<ReturnType<typeof loadIntakeCustomerRecord>>>,
  customerBalanceUsd: string,
): PaymentIntakeCustomerPayload {
  const index = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;
  return {
    id: cust.id,
    displayName: cust.displayName,
    nameEn: cust.nameEn,
    nameHe: cust.nameHe,
    nameAr: cust.nameAr,
    phone: cust.phone,
    customerCode: cust.customerCode,
    customerIndex: index,
    customerBalanceUsd,
  };
}

function intakeOrderBaseWhere(cid: string, paymentWorkCountry: WorkCountryCode): Prisma.OrderWhereInput {
  return {
    customerId: cid,
    deletedAt: null,
    status: { notIn: ["DEBT_WITHDRAWAL", "CANCELLED"] },
    countryCode: paymentWorkCountry,
  };
}

function mapOrderToIntakeRow(
  o: IntakeOrderRecord,
  paidByOrder: Map<string, Prisma.Decimal>,
  latestCodeByOrder: Map<string, string | null>,
  latestPaymentDateByOrder: Map<string, string | null>,
  actualByOrderMethod: Map<string, Map<string, number>>,
  /** Legacy fallback: paid-by-currency:bucket from PaymentMethodAllocation */
  allocByOrderBucketCur: Map<string, Map<string, number>>,
): PaymentIntakeOrderRow {
  const deal = o.amountUsd ?? new Prisma.Decimal(0);
  const com = o.commissionUsd ?? new Prisma.Decimal(0);
  const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
  const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
  const totalN = Number(totalUsdVal.toString());
  const paidN = Number(paidSum.toString());
  const remainingN = orderLedgerBalanceUsd({ totalAmountUsd: totalN, dbPaidUsd: paidN });
  const remDec = new Prisma.Decimal(remainingN).toDecimalPlaces(2, 4);
  const status = debtStatus(paidN, totalN);
  const rateDec = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate ?? new Prisma.Decimal(0);
  const rateN = Number(rateDec.toString()) || 0;
  const ilsDec = o.totalIlsWithVat ?? o.totalIls ?? new Prisma.Decimal(0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const isComposite = isCompositePaymentMethod(o.paymentMethod);
  const actualMap = actualByOrderMethod.get(o.id) ?? new Map<string, number>();
  const actualMethods = [...actualMap.entries()]
    .filter(([, usd]) => usd > 0.0001)
    .map(([method, usd]) => ({ method, label: PAYMENT_METHOD_LABELS[method] ?? method, usd: round2(usd) }));
  let breakdown: OrderBreakdownMethodRow[] = [];
  let hasMethodDeviation = false;
  if (o.paymentBreakdown.length > 0) {
    /**
     * Matching Engine SSOT — סכומים במטבע המקורי של כל שורה.
     * אין המרת ILS→USD ליתרות אמצעים. אין FIFO בטעינה.
     */
    const plannedEntries: Array<{
      method: string;
      currency: "USD" | "ILS";
      planned: number;
      paid: number;
      remaining: number;
    }> = [];
    for (const b of o.paymentBreakdown) {
      const currency: "USD" | "ILS" = b.currency?.toUpperCase() === "ILS" ? "ILS" : "USD";
      const planned = round2(Math.max(0, Number(b.amount.toString())));
      const paidPersisted = Number(b.paidAmount?.toString?.() ?? b.paidAmount ?? 0);
      const remPersisted =
        b.remainingAmount != null
          ? Number(b.remainingAmount.toString?.() ?? b.remainingAmount)
          : null;
      let paid = round2(Number.isFinite(paidPersisted) ? Math.max(0, paidPersisted) : 0);
      let remaining =
        remPersisted != null && Number.isFinite(remPersisted)
          ? round2(Math.max(0, remPersisted))
          : round2(Math.max(0, planned - paid));
      plannedEntries.push({ method: b.paymentMethod, currency, planned, paid, remaining });
    }

    // Legacy seed: רק כשאין paidAmount — מייחסים לפי PaymentMethodAllocation לפי מטבע
    const persistedPaidSum = round2(plannedEntries.reduce((s, e) => s + e.paid, 0));
    if (persistedPaidSum <= 0.005 && paidN > 0.005) {
      const byBucketCur = allocByOrderBucketCur.get(o.id);
      if (byBucketCur && byBucketCur.size > 0) {
        for (const e of plannedEntries) {
          const bucket = paymentMethodBucketKey(e.method);
          const key = `${e.currency}:${bucket}`;
          const paid = round2(byBucketCur.get(key) ?? 0);
          e.paid = paid;
          e.remaining = round2(Math.max(0, e.planned - paid));
        }
      }
    }

    // SSOT: paid במסלול אמצעי = planned − remaining; לא paidAmount ב-DB כשאין Payment
    if (paidN <= 0.005) {
      for (const e of plannedEntries) {
        e.paid = 0;
        e.remaining = e.planned;
      }
    }

    breakdown = plannedEntries.map((e) => {
      const asUsd =
        e.currency === "ILS" && rateN > 0 ? round2(e.planned / rateN) : e.planned;
      const paidAsUsd =
        e.currency === "ILS" && rateN > 0 ? round2(e.paid / rateN) : e.paid;
      const remAsUsd =
        e.currency === "ILS" && rateN > 0 ? round2(e.remaining / rateN) : e.remaining;
      return {
        method: e.method,
        label: PAYMENT_METHOD_LABELS[e.method] ?? e.method,
        currency: e.currency,
        planned: e.planned,
        paid: e.paid,
        remaining: e.remaining,
        // תאימות לשערים/גשרים ישנים שעדיין מצפים ל-USD
        plannedUsd: asUsd,
        paidUsd: paidAsUsd,
        remainingUsd: remAsUsd,
      };
    });
    hasMethodDeviation = computeOrderMethodDeviation(
      plannedEntries.map((e) => ({
        method: e.method,
        usd: e.currency === "ILS" && rateN > 0 ? e.planned / rateN : e.planned,
      })),
      actualMethods.map((a) => ({ method: a.method, usd: a.usd })),
    ).hasDeviation;
    breakdown = reconcileOrderBreakdownWithLedger(breakdown, remainingN);
  }
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    paymentCode: latestCodeByOrder.get(o.id) ?? null,
    dateYmd: o.orderDate ? formatLocalYmd(new Date(o.orderDate)) : "—",
    week: o.weekCode?.trim() || null,
    rate: rateN > 0 ? rateN.toFixed(4) : "—",
    amountUsd: deal.toFixed(2),
    commissionUsd: com.toFixed(2),
    totalIls: ilsDec.toFixed(2),
    totalAmountUsd: totalUsdVal.toFixed(2),
    dbPaidUsd: paidSum.toFixed(2),
    dbRemainingUsd: remDec.toFixed(2),
    status,
    lastPaymentDateYmd: latestPaymentDateByOrder.get(o.id) ?? null,
    sourceCountry: o.sourceCountry != null ? String(o.sourceCountry) : null,
    isComposite,
    breakdown,
    actualMethods,
    hasMethodDeviation,
  };
}

async function attachPaymentsAndMapRows(
  orders: IntakeOrderRecord[],
): Promise<PaymentIntakeOrderRow[]> {
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  const latestCodeByOrder = new Map<string, string | null>();
  const latestPaymentDateByOrder = new Map<string, string | null>();
  const actualByOrderMethod = new Map<string, Map<string, number>>();

  if (orderIds.length > 0) {
    const [sums, payRows, planByOrder] = await Promise.all([
      groupByActivePayments(
        "orderId",
        {
          orderId: { in: orderIds },
          amountUsd: { not: null },
          NOT: { businessType: { in: ["ADJUSTMENT_FEE", "CUSTOMER_CREDIT"] } },
        },
        { amountUsd: true },
      ),
      prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          orderId: true,
          paymentCode: true,
          paymentDate: true,
          createdAt: true,
          status: true,
          amountUsd: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
        },
      }),
      loadPaymentPlanSummariesByOrderId(orderIds),
    ]);

    for (const s of sums) {
      if (s.orderId) paidByOrder.set(s.orderId, s._sum?.amountUsd ?? new Prisma.Decimal(0));
    }

    const paymentIdToOrderId = new Map<string, string>();
    for (const p of payRows) {
      if (!p.orderId) continue;
      paymentIdToOrderId.set(p.id, p.orderId);
      if (!latestCodeByOrder.has(p.orderId)) {
        latestCodeByOrder.set(p.orderId, p.paymentCode?.trim() || null);
        const dt = p.paymentDate ?? p.createdAt;
        latestPaymentDateByOrder.set(p.orderId, dt ? formatLocalYmd(new Date(dt)) : null);
      }
      if (String(p.status) !== "ACTIVE") continue;
      const amt = p.amountUsd ? Number(p.amountUsd.toString()) : 0;
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const method = (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
      if (!method) continue;
      let byMethod = actualByOrderMethod.get(p.orderId);
      if (!byMethod) {
        byMethod = new Map<string, number>();
        actualByOrderMethod.set(p.orderId, byMethod);
      }
      byMethod.set(method, (byMethod.get(method) ?? 0) + amt);
    }

    const allocByOrderBucketCur = new Map<string, Map<string, number>>();
    const activePaymentIds = [...paymentIdToOrderId.keys()].filter((pid) => {
      const p = payRows.find((x) => x.id === pid);
      return p && String(p.status) === "ACTIVE";
    });
    if (activePaymentIds.length > 0) {
      const allocRows = await prisma.paymentMethodAllocation.findMany({
        where: { paymentId: { in: activePaymentIds } },
        select: { paymentId: true, method: true, currency: true, sourceAmount: true, amountUsd: true },
      });
      for (const a of allocRows) {
        const orderId = paymentIdToOrderId.get(a.paymentId);
        if (!orderId) continue;
        const cur = a.currency?.toUpperCase() === "ILS" ? "ILS" : "USD";
        const bucket = paymentMethodBucketKey(a.method);
        const amt =
          cur === "ILS"
            ? Number(a.sourceAmount.toString())
            : Number(a.amountUsd.toString());
        if (!Number.isFinite(amt) || amt <= 0) continue;
        let byBucket = allocByOrderBucketCur.get(orderId);
        if (!byBucket) {
          byBucket = new Map<string, number>();
          allocByOrderBucketCur.set(orderId, byBucket);
        }
        const key = `${cur}:${bucket}`;
        byBucket.set(key, Math.round(((byBucket.get(key) ?? 0) + amt) * 100) / 100);
      }
    }

    const rows = orders.map((o) => ({
      ...mapOrderToIntakeRow(
        o,
        paidByOrder,
        latestCodeByOrder,
        latestPaymentDateByOrder,
        actualByOrderMethod,
        allocByOrderBucketCur,
      ),
      paymentPlan: planByOrder.get(o.id) ?? null,
    }));

    return enrichIntakeOrdersWithCommissionSsot(rows);
  }

  return [];
}

/** מחיל currentFee = base + Σ fees על שורות קליטה */
async function enrichIntakeOrdersWithCommissionSsot(
  rows: PaymentIntakeOrderRow[],
): Promise<PaymentIntakeOrderRow[]> {
  if (rows.length === 0) return rows;
  const orderIds = rows.map((r) => r.id);
  const fees = await prisma.paymentAdjustmentFee.findMany({
    where: {
      orderId: { in: orderIds },
      status: { not: "CANCELLED" },
    },
    select: { orderId: true, amountUsd: true, userChoice: true },
  });
  const feesByOrder = new Map<string, Array<{ amountUsd: number; userChoice: string | null }>>();
  for (const fee of fees) {
    if (!fee.orderId) continue;
    if (isLegacyCommissionOrderMutationFee(fee.userChoice)) continue;
    const list = feesByOrder.get(fee.orderId) ?? [];
    list.push({ amountUsd: Number(fee.amountUsd ?? 0), userChoice: fee.userChoice });
    feesByOrder.set(fee.orderId, list);
  }

  return rows.map((row) => {
    const base = Number(row.commissionUsd) || 0;
    const breakdown = computeOrderCommissionBreakdown({
      orderId: row.id,
      baseCommissionUsd: base,
      fees: feesByOrder.get(row.id) ?? [],
    });
    return {
      ...row,
      commissionBaseUsd: breakdown.baseCommissionUsd.toFixed(2),
      commissionAdjustmentsUsd: breakdown.adjustmentsUsd.toFixed(2),
      commissionHasAdjustments: breakdown.hasAdjustments,
      commissionUsd: breakdown.currentCommissionUsd.toFixed(2),
    };
  });
}

/** הזמנות לקוח בלבד — לטעינה ברקע */
export async function loadPaymentIntakeOrdersForCustomer(
  params: IntakeLoadParams,
): Promise<{ ok: true; orders: PaymentIntakeOrderRow[] } | { ok: false; error: string }> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const cust = await loadIntakeCustomerRecord(cid);
  if (!cust) return { ok: false, error: "לקוח לא נמצא" };

  const intakeWeekCode = params.weekCodeForOpenBalances?.trim() || null;
  /** שבוע מקור ההזמנות — סינון orderDate עד סוף שבוע AH (לא שבוע הקליטה) */
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(intakeWeekCode);
  const paymentWorkCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const baseWhere = intakeOrderBaseWhere(cid, paymentWorkCountry);

  const weekOrders = await prisma.order.findMany({
    where: { ...baseWhere, ...(weekDateWhere ?? {}) },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: INTAKE_ORDER_SELECT,
  });

  const [rows, withdrawalUsd] = await Promise.all([
    attachPaymentsAndMapRows(weekOrders),
    loadCustomerDebtWithdrawalUsd(cid, paymentWorkCountry),
  ]);
  const collectibleRows = applyDebtWithdrawalToIntakeOrders(rows, withdrawalUsd);

  void (async () => {
    try {
      const { financeIntakeParityEnabled, runPaymentIntakeParity } = await import(
        "@/lib/finance-data/parity/payment-intake-parity"
      );
      if (!financeIntakeParityEnabled()) return;
      const { toLegacyParityOrders } = await import("@/lib/payment-intake-parity-adapter");
      await runPaymentIntakeParity({
        customerId: cid,
        legacyOrders: toLegacyParityOrders(collectibleRows),
      });
    } catch (err) {
      console.error("[finance-intake-parity] failed", err);
    }
  })();

  return { ok: true, orders: collectibleRows };
}

async function loadCustomerDebtWithdrawalUsd(
  customerId: string,
  paymentWorkCountry: WorkCountryCode,
): Promise<number> {
  const rows = await prisma.order.findMany({
    where: {
      customerId,
      deletedAt: null,
      status: OS.DEBT_WITHDRAWAL,
      countryCode: paymentWorkCountry,
    },
    select: {
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      debtWithdrawalUsd: true,
    },
  });
  return rows.reduce((sum, row) => sum + orderCustomerCreditUsd(row), 0);
}

/** שורות תשלומי לקוח (למחשבון) — לטעינה ברקע */
export async function loadPaymentIntakeCustomerPaymentsForCustomer(
  params: IntakeLoadParams,
): Promise<{ ok: true; customerPayments: PaymentIntakeCustomerPaymentRow[] } | { ok: false; error: string }> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const paymentWorkCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const customerPaymentRows = await findActiveCustomerPayments({
    where: { customerId: cid, countryCode: paymentWorkCountry },
    select: {
      amountUsd: true,
      amountIls: true,
      exchangeRate: true,
      paymentMethod: true,
      usdPaymentMethod: true,
      ilsPaymentMethod: true,
    },
  });

  return {
    ok: true,
    customerPayments: customerPaymentRows.map((p) => ({
      amountUsd: p.amountUsd != null ? p.amountUsd.toFixed(4) : null,
      amountIls: p.amountIls != null ? p.amountIls.toFixed(4) : null,
      exchangeRate: p.exchangeRate != null ? p.exchangeRate.toFixed(6) : null,
      paymentMethod: p.paymentMethod,
      usdPaymentMethod: p.usdPaymentMethod,
      ilsPaymentMethod: p.ilsPaymentMethod,
    })),
  };
}

/** יתרה פנימית + חוב פתוח — לטעינה ברקע (SSOT זהה לכרטסת / יתרות) */
export async function loadPaymentIntakeBalancesForCustomer(
  params: IntakeLoadParams,
): Promise<
  | {
      ok: true;
      customerBalanceUsd: string;
      openDebtSignedUsd: number;
      internalSignedUsd: string;
      commissionBalanceUsd: number;
      creditBalanceUsd: number;
      financialStatus: "DEBT" | "BALANCED" | "CREDIT";
      /** Σ amountUsd — הזמנות רגילות (ללא משיכות מחוב) */
      totalOrdersBeforeCommissionUsd: number;
      /** Σ totalUsd (עסקה+עמלה) — כרטסת «סה״כ הזמנות» */
      totalOrdersUsd: number;
      totalPaymentsUsd: number;
      /** Σ משיכות מחוב (DEBT_WITHDRAWAL) */
      totalWithdrawalsUsd: number;
    }
  | { ok: false; error: string }
> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const paymentWorkCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
  const { getCustomerAccountBalances, financialStateFromAccounts } = await import(
    "@/lib/customer-account-balances"
  );
  const debtScope = openDebtScopeForWorkCountry(paymentWorkCountry);

  const [accounts, debt] = await Promise.all([
    getCustomerAccountBalances(cid, debtScope),
    getCustomerOpenDebt(cid, debtScope),
  ]);
  const financial = financialStateFromAccounts(accounts);

  // סנכרון snapshot מ־SSOT (לא תיקון ידני ללקוח) — מונע יתרת DB ישנה בחיפוש
  try {
    const { persistCustomerBalanceSnapshot } = await import("@/lib/customer-open-debt");
    await persistCustomerBalanceSnapshot(cid, debt.internalSignedUsd);
  } catch {
    /* snapshot best-effort */
  }

  return {
    ok: true,
    customerBalanceUsd: debt.internalSignedUsd.toFixed(2),
    openDebtSignedUsd: accounts.openDebtUsd,
    internalSignedUsd: debt.internalSignedUsd.toFixed(2),
    commissionBalanceUsd: accounts.commissionBalanceUsd,
    creditBalanceUsd: accounts.availableCreditUsd,
    financialStatus: financial.financialStatus,
    totalOrdersBeforeCommissionUsd: Number(debt.totalOrdersBeforeCommissionUsd.toFixed(2)),
    totalOrdersUsd: Number(debt.totalOrdersUsd.toFixed(2)),
    totalPaymentsUsd: Number(debt.totalPaymentsUsd.toFixed(2)),
    totalWithdrawalsUsd: Number(debt.totalWithdrawalsUsd.toFixed(2)),
  };
}

/** טעינה מלאה — תאימות לאחור */
export async function loadPaymentIntakeCustomerWorkspace(
  params: IntakeLoadParams,
): Promise<
  | {
      ok: true;
      customer: PaymentIntakeCustomerPayload;
      orders: PaymentIntakeOrderRow[];
      customerPayments: PaymentIntakeCustomerPaymentRow[];
    }
  | { ok: false; error: string }
> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const cust = await loadIntakeCustomerRecord(cid);
  if (!cust) return { ok: false, error: "לקוח לא נמצא" };

  const [ordersRes, paymentsRes, balancesRes] = await Promise.all([
    loadPaymentIntakeOrdersForCustomer(params),
    loadPaymentIntakeCustomerPaymentsForCustomer(params),
    loadPaymentIntakeBalancesForCustomer(params),
  ]);

  if (!ordersRes.ok) return ordersRes;
  if (!paymentsRes.ok) return paymentsRes;
  if (!balancesRes.ok) return balancesRes;

  return {
    ok: true,
    customer: customerPayloadFromRow(cust, balancesRes.customerBalanceUsd),
    orders: ordersRes.orders,
    customerPayments: paymentsRes.customerPayments,
  };
}
