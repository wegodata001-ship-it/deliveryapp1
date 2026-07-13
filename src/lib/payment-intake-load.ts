import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderBreakdownMethodRow, PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { breakdownLineUsd, computeOrderMethodDeviation, isCompositePaymentMethod } from "@/lib/payment-breakdown-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import type { PaymentIntakeCustomerPaymentRow } from "@/lib/payment-intake-customer-kpi";
import { annotateIntakeOrderGroups, mergeIntakeOrdersById } from "@/lib/payment-intake-order-groups";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { loadPaymentPlanSummariesByOrderId } from "@/lib/payment-plan-service";
import { DEFAULT_WORK_COUNTRY, normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";
import { findActiveCustomerPayments, groupByActivePayments } from "@/lib/payment-record-status";

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

const MONEY_EPS = 0.02;

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
    select: { paymentMethod: true, amount: true, currency: true },
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

/** הזמנות פתוחות עם חלוקת תשלום — ללא סינון שבוע (מניעת אובדן חלוקה במעבר שבוע) */
async function loadOpenOrdersWithBreakdown(
  cid: string,
  paymentWorkCountry: WorkCountryCode,
): Promise<IntakeOrderRecord[]> {
  return prisma.order.findMany({
    where: {
      ...intakeOrderBaseWhere(cid, paymentWorkCountry),
      paymentBreakdown: { some: {} },
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: INTAKE_ORDER_SELECT,
  });
}

function mapOrderToIntakeRow(
  o: IntakeOrderRecord,
  paidByOrder: Map<string, Prisma.Decimal>,
  latestCodeByOrder: Map<string, string | null>,
  latestPaymentDateByOrder: Map<string, string | null>,
  actualByOrderMethod: Map<string, Map<string, number>>,
): PaymentIntakeOrderRow {
  const deal = o.amountUsd ?? new Prisma.Decimal(0);
  const com = o.commissionUsd ?? new Prisma.Decimal(0);
  const totalUsdVal = o.totalUsd ?? deal.add(com).toDecimalPlaces(4, 4);
  const paidSum = paidByOrder.get(o.id) ?? new Prisma.Decimal(0);
  const remDec = totalUsdVal.sub(paidSum).toDecimalPlaces(2, 4);
  const paidN = Number(paidSum.toString());
  let status: "unpaid" | "partial" | "paid" = "unpaid";
  if (Number(remDec.toString()) <= MONEY_EPS) status = "paid";
  else if (paidN > MONEY_EPS) status = "partial";
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
    const plannedByMethod = new Map<string, number>();
    for (const b of o.paymentBreakdown) {
      const usd =
        breakdownLineUsd(
          { amount: b.amount.toString(), currency: b.currency === "ILS" ? "ILS" : "USD" },
          rateN,
        ) ?? 0;
      plannedByMethod.set(b.paymentMethod, (plannedByMethod.get(b.paymentMethod) ?? 0) + usd);
    }
    breakdown = [...plannedByMethod.entries()].map(([method, plannedUsd]) => {
      const paid = actualMap.get(method) ?? 0;
      return {
        method,
        label: PAYMENT_METHOD_LABELS[method] ?? method,
        plannedUsd: round2(plannedUsd),
        paidUsd: round2(paid),
        remainingUsd: Math.max(0, round2(plannedUsd - paid)),
      };
    });
    hasMethodDeviation = computeOrderMethodDeviation(
      [...plannedByMethod.entries()].map(([method, usd]) => ({ method, usd })),
      actualMethods.map((a) => ({ method: a.method, usd: a.usd })),
    ).hasDeviation;
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
  intakeWeekCode: string | null | undefined,
): Promise<PaymentIntakeOrderRow[]> {
  const orderIds = orders.map((o) => o.id);
  const paidByOrder = new Map<string, Prisma.Decimal>();
  const latestCodeByOrder = new Map<string, string | null>();
  const latestPaymentDateByOrder = new Map<string, string | null>();
  const actualByOrderMethod = new Map<string, Map<string, number>>();

  if (orderIds.length > 0) {
    const [sums, payRows, planByOrder] = await Promise.all([
      groupByActivePayments("orderId", { orderId: { in: orderIds }, amountUsd: { not: null } }, { amountUsd: true }),
      prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        select: {
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
    for (const p of payRows) {
      if (!p.orderId) continue;
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

    const rows = orders.map((o) => ({
      ...mapOrderToIntakeRow(o, paidByOrder, latestCodeByOrder, latestPaymentDateByOrder, actualByOrderMethod),
      paymentPlan: planByOrder.get(o.id) ?? null,
    }));

    return annotateIntakeOrderGroups(rows, intakeWeekCode);
  }

  return annotateIntakeOrderGroups([], intakeWeekCode);
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
  const weekDateWhere = paymentIntakeOrderDateThroughAhWeekEnd(intakeWeekCode);
  const paymentWorkCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const baseWhere = intakeOrderBaseWhere(cid, paymentWorkCountry);

  const [weekOrders, openBreakdownOrders] = await Promise.all([
    prisma.order.findMany({
      where: { ...baseWhere, ...(weekDateWhere ?? {}) },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: INTAKE_ORDER_SELECT,
    }),
    weekDateWhere
      ? loadOpenOrdersWithBreakdown(cid, paymentWorkCountry)
      : Promise.resolve([] as IntakeOrderRecord[]),
  ]);

  const mergedOrders = mergeIntakeOrdersById(weekOrders, openBreakdownOrders).sort((a, b) => {
    const ad = a.orderDate?.getTime() ?? 0;
    const bd = b.orderDate?.getTime() ?? 0;
    if (ad !== bd) return ad - bd;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const rows = await attachPaymentsAndMapRows(mergedOrders, intakeWeekCode);

  return { ok: true, orders: rows };
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

/** יתרה פנימית + חוב פתוח — לטעינה ברקע */
export async function loadPaymentIntakeBalancesForCustomer(
  params: IntakeLoadParams,
): Promise<
  | {
      ok: true;
      customerBalanceUsd: string;
      openDebtSignedUsd: number;
      internalSignedUsd: string;
    }
  | { ok: false; error: string }
> {
  const cid = params.customerId.trim();
  if (!cid) return { ok: false, error: "חסר לקוח" };

  const paymentWorkCountry = normalizeWorkCountryCode(params.paymentWorkCountryRaw) ?? DEFAULT_WORK_COUNTRY;
  const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");

  const [customerBalanceUsd, debt] = await Promise.all([
    (async () => {
      const { getCustomerInternalBalanceUsd } = await import("@/lib/customer-open-debt");
      return getCustomerInternalBalanceUsd(cid, openDebtScopeForWorkCountry(paymentWorkCountry));
    })(),
    getCustomerOpenDebt(cid, openDebtScopeForWorkCountry(paymentWorkCountry)),
  ]);

  return {
    ok: true,
    customerBalanceUsd: customerBalanceUsd.toFixed(2),
    openDebtSignedUsd: Number(debt.signedBalanceUsd.toString()),
    internalSignedUsd: debt.internalSignedUsd.toFixed(2),
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
