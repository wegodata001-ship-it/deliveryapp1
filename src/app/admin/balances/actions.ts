"use server";

import { unstable_noStore as noStore } from "next/cache";
import { OrderSourceCountry, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { perfEnabled } from "@/lib/perf-log";
import { logDbEnvDiagnostics } from "@/lib/db-env-diagnostics";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  endOfLocalDay,
  formatLocalYmd,
  getAhWeekRange,
  normalizeAhWeekCode,
  normalizeYmdRangePair,
  parseLocalDate,
} from "@/lib/work-week";
import { resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { ORDER_COUNTRY_CODES, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WORK_COUNTRY,
  workCountryFromOrderSourceCountry,
  type WorkCountryCode,
} from "@/lib/work-country";
import {
  fetchCustomerOpenOrderEnrichment,
  resolveOrderRowHighlight,
  type CustomerOpenOrderLine,
  type CustomerOpenOrderEnrich,
  type OrderPhaseUi,
} from "@/lib/customer-balance-order-status";
import { computeSignedFromTotals } from "@/lib/customer-balance";
import { calculateCustomerBalances } from "@/lib/customer-balance-calculator";
import {
  orderStatusesForBalanceFilter,
  parseCustomerBalanceOrderStatusFilter,
  STATUS_BALANCE_KPI_SPECS,
  type CustomerBalanceOrderStatusFilter,
  type StatusBalanceKpiKey,
} from "@/lib/customer-balance-order-status-filter";
import {
  isDebtWithdrawalOrderStatus,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
} from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
import { activePaidPaymentWhere } from "@/lib/payment-record-status";

export type CustomerBalanceStatus = "NOT_PAID" | "PARTIAL" | "PAID" | "PROBLEM" | "PAUSED";

/** סינון לפי סטטוס הזמנות פתוחות (מודאל דוחות) */
export type CustomerBalanceOrderPhaseFilter = "ALL" | OrderPhaseUi;

/** סינון לפי מצב יתרה (חישוב), לא לפי סטטוס גבייה */
export type CustomerBalanceDebtFilter =
  | "ALL"
  | "OWES"
  | "CREDIT"
  | "BALANCED"
  | "PAID_FULL"
  | "PARTIAL"
  | "NOT_PAID"
  | "LOW_BALANCE";

/** סטטוס תשלום לתצוגה (עמודת סטטוס + ייצוא) */
export type CustomerBalancePaymentFlow = "PAID" | "PARTIAL" | "NOT_PAID" | "LOW_DEBT";

export type CustomerBalanceSort =
  | "balance_desc"
  | "balance_asc"
  | "name"
  | "orders_total"
  | "week_desc"
  | "week_asc"
  | "last_order_desc"
  | "last_order_asc";

export type CustomerBalanceFilters = {
  /** חיפוש אחד על שם / קוד / טלפון / הערות לקוח */
  smart?: string;
  name?: string;
  code?: string;
  phone?: string;
  balanceDebtStatus?: CustomerBalanceDebtFilter;
  minBalanceIls?: string;
  maxBalanceIls?: string;
  /** מינימום/מקסימום יתרה בדולר (מספרים חיוביים — מסננים לפי עמודת balanceUSD) */
  minBalanceUsd?: string;
  maxBalanceUsd?: string;
  /** כאשר enrichOpenOrders — סינון לפי סטטוס הזמנה פתוחה */
  orderPhase?: CustomerBalanceOrderPhaseFilter;
  /** סינון חישוב יתרה לפי סטטוס הזמנה (DB) */
  orderStatus?: CustomerBalanceOrderStatusFilter;
  /** true = רק לקוחות עם תשלומים בטווח */
  hasPayments?: boolean;
  sort?: CustomerBalanceSort;
  /** סינון תצוגה: כל / חוב בש״ח בלבד / חוב בדולר בלבד */
  currencyView?: "" | "ILS" | "USD";
};

export type CustomerBalanceQuery = {
  page: number;
  limit: number;
  fromYmd?: string;
  toYmd?: string;
  weekCode?: string;
  /** סינון לקוח בודד (למשל מפילטר הדוחות הגלובלי) */
  customerId?: string;
  /**
   * צבירה עד סוף שבוע AH (כולל): הזמנות/תשלומים עם תאריך ≤ סוף השבוע, בלי סינון weekCode שורתי.
   * אם מוגדר יחד עם toYmd — נלקח המוקדם מביניהם.
   */
  uptoWeekCode?: string;
  /** מדינת מקור הזמנה — ריק = כל המדינות */
  sourceCountry?: OrderCountryCode | "";
  /** טעינת סיכום/פירוט הזמנות פתוחות + KPI למודאל דוחות */
  enrichOpenOrders?: boolean;
  /** צבירה מצטברת לכל חיי הלקוח (לא לפי שבוע בלבד) */
  lifetime?: boolean;
  filters?: CustomerBalanceFilters;
};

export type CustomerBalanceRow = {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  /** מידע עסקי בלבד: סה"כ הזמנות מצטבר ב-USD מאז היום הראשון (ללא משיכות מחוב). */
  lifetimeOrdersUSD: string;
  /** מספר הזמנות שנכנסו לחישוב בטווח */
  ordersCount: number;
  totalOrdersUSD: string;
  totalPaymentsUSD: string;
  totalBalanceUSD: string;
  totalOrdersILS: string;
  totalPaymentsILS: string;
  /** סכום עסקאות מקורי (לפני עמלה) בש״ח */
  totalDealsILS: string;
  /** סה״כ עמלות בש״ח */
  totalCommissionsILS: string;
  /** סה״כ תקבולים בפועל (תשלומים + זיכויים כלליים) */
  totalReceiptsILS: string;
  /** יתרה = הזמנות − תשלומים (ללא זיכויים נפרדים) */
  totalBalanceILS: string;
  totalCreditsILS: string;
  noOrdersInRange: boolean;
  balanceILS: string;
  /** internalSigned (חישוב): שלילי=חוב, חיובי=זכות — לתצוגה השתמשו ב-CustomerBalanceView */
  signedIls: string;
  balanceUSD: string;
  signedUsd: string;
  expectedILS: string;
  receivedILS: string;
  status: CustomerBalanceStatus;
  autoStatus: CustomerBalanceStatus;
  statusOverride: CustomerBalanceStatus | null;
  /** תשלום / יתרה פתוחה — לעמודת סטטוס ולסינון "יתרה נמוכה" */
  paymentFlow: CustomerBalancePaymentFlow;
  /** תאריך ההזמנה האחרונה שנכנסה לחישוב (למיון) */
  lastOrderYmd: string | null;
  /** מספר AH מקסימלי מההזמנות בטווח (למיון לפי שבוע) */
  maxAhWeekNum: number;
  /** enrichOpenOrders בלבד */
  ordersStatusSummary?: string;
  ordersOpenLines?: CustomerOpenOrderLine[];
  orderPhaseBuckets?: Record<OrderPhaseUi, number>;
  orderRowHighlight?: "ready-unpaid" | "delayed" | null;
};

export type CustomerBalancesPayload = {
  rows: CustomerBalanceRow[];
  page: number;
  limit: number;
  totalRows: number;
  totalPages: number;
  stats: {
    totalDebtIls: string;
    totalCreditIls: string;
    /** סה״כ תשלומים (ש״ח) בקבוצה המסוננת */
    totalPaymentsIls: string;
    totalDebtUsd: string;
    totalCreditUsd: string;
    totalPaymentsUsd: string;
    withDebtCount: number;
    withCreditCount: number;
    noDebtCount: number;
    partialCount: number;
    notPaidCount: number;
    /** חוב בש״ח מעל סף (תצוגה בלבד) */
    highDebtCount: number;
    /** לקוחות עם תשלומים בטווח */
    withPaymentsCount: number;
    /** סיכום תצוגה — סכום שדות שורה (אותה קבוצה מסוננת) */
    totalLifetimeOrdersUsd: string;
    totalOrdersAfterCommissionUsd: string;
    totalNetBalanceUsd: string;
  };
  /** KPI נוספים למודאל דוח יתרות (לפי אותה קבוצה מסוננת לפני pagination) */
  reportModalStats?: {
    totalDebtUsd: string;
    customersInTreatment: number;
    customersNoPayment: number;
    readyUnpaidOrdersCount: number;
  };
  /** סה״כ יתרות לגבייה (USD) לפי סטטוס הזמנה — לפני סינון סטטוס בטבלה */
  statusBalanceKpis: Record<StatusBalanceKpiKey, string>;
  /** סטטוס הזמנה הפעיל בחישוב השורות */
  activeOrderStatusFilter: CustomerBalanceOrderStatusFilter;
};

const STATUS_VALUES = new Set<CustomerBalanceStatus>(["NOT_PAID", "PARTIAL", "PAID", "PROBLEM", "PAUSED"]);

const DEBT_FILTER_VALUES = new Set<CustomerBalanceDebtFilter>([
  "ALL",
  "OWES",
  "CREDIT",
  "BALANCED",
  "PAID_FULL",
  "PARTIAL",
  "NOT_PAID",
  "LOW_BALANCE",
]);

const SORT_VALUES = new Set<CustomerBalanceSort>([
  "balance_desc",
  "balance_asc",
  "name",
  "orders_total",
  "week_desc",
  "week_asc",
  "last_order_desc",
  "last_order_asc",
]);

const ORDER_PHASE_FILTER_VALUES = new Set<CustomerBalanceOrderPhaseFilter>([
  "ALL",
  "READY",
  "IN_PROGRESS",
  "PARTIAL",
  "DELAYED",
]);

/** חוב בדולר מתחת לסף — "יתרה נמוכה" */
const LOW_DEBT_USD = 5;
/** חוב בש״ח מעליו — נספר ב־KPI "יתרה גבוהה" */
const HIGH_DEBT_ILS = 15_000;

async function ensureStatusOverrideTable() {
  if (!statusOverrideTableReady) {
    statusOverrideTableReady = (async () => {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "CustomerBalanceStatusOverride" (
          "customerId" TEXT PRIMARY KEY,
          "statusOverride" TEXT,
          "note" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ALTER COLUMN "statusOverride" DROP NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE "CustomerBalanceStatusOverride" ADD COLUMN IF NOT EXISTS "note" TEXT`;
    })();
  }
  await statusOverrideTableReady;
}

/** מצמצם לקוחות לפעילות בטווח — אותו חישוב יתרה, פחות שורות ריקות */
function buildCustomerActivityScope(
  orderNestedWhere: Prisma.OrderWhereInput,
  paymentDateFilter: Prisma.DateTimeFilter | undefined,
  weekCode: string | undefined,
  cumulativeThrough: boolean,
  orderCountryPrisma: OrderSourceCountry | undefined,
  paymentCountryCode?: WorkCountryCode,
): Prisma.CustomerWhereInput {
  const paymentBase: Prisma.PaymentWhereInput = {
    ...activePaidPaymentWhere,
    ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
    ...(!cumulativeThrough && weekCode ? { weekCode } : {}),
    ...(paymentCountryCode ? { countryCode: paymentCountryCode } : {}),
  };
  const paymentLinked: Prisma.PaymentWhereInput = {
    ...paymentBase,
    orderId: { not: null },
    order: {
      deletedAt: null,
      ...(orderCountryPrisma ? { sourceCountry: orderCountryPrisma } : {}),
      ...(paymentCountryCode ? { countryCode: paymentCountryCode } : {}),
    },
  };
  const paymentGeneral: Prisma.PaymentWhereInput = {
    ...paymentBase,
    orderId: null,
  };
  return {
    OR: [
      { orders: { some: orderNestedWhere } },
      { payments: { some: paymentLinked } },
      { payments: { some: paymentGeneral } },
    ],
  };
}

function money(n: Prisma.Decimal): string {
  return n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function paymentIlsValue(p: {
  totalIlsWithVat: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.totalIlsWithVat) return p.totalIlsWithVat;
  if (p.amountIls) return p.amountIls;
  if (p.amountUsd && p.exchangeRate) return p.amountUsd.mul(p.exchangeRate);
  return new Prisma.Decimal(0);
}

type OrderMoneyFields = {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  commissionIls: Prisma.Decimal | null;
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
};

function orderRate(o: OrderMoneyFields): Prisma.Decimal | null {
  return o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
}

function orderExpectedIlsValue(o: OrderMoneyFields): Prisma.Decimal {
  if (o.totalIlsWithVat) return o.totalIlsWithVat;
  if (o.totalIls) return o.totalIls;
  const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
  const rate = orderRate(o);
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
}

function orderDealIlsValue(o: OrderMoneyFields): Prisma.Decimal {
  if (o.amountIls) return o.amountIls;
  const rate = orderRate(o);
  if (!rate) return new Prisma.Decimal(0);
  return (o.amountUsd ?? new Prisma.Decimal(0)).mul(rate);
}

function orderCommissionIlsValue(o: OrderMoneyFields): Prisma.Decimal {
  if (o.commissionIls) return o.commissionIls;
  const rate = orderRate(o);
  if (!rate) return new Prisma.Decimal(0);
  return (o.commissionUsd ?? new Prisma.Decimal(0)).mul(rate);
}

function autoStatus(expected: Prisma.Decimal, received: Prisma.Decimal): CustomerBalanceStatus {
  if (expected.lte(new Prisma.Decimal("0.01"))) return "PAID";
  if (received.lte(new Prisma.Decimal("0.01"))) return "NOT_PAID";
  if (received.lt(expected.sub(new Prisma.Decimal("0.01")))) return "PARTIAL";
  return "PAID";
}

function ahWeekNumFromCode(code: string | null | undefined): number {
  if (!code) return 0;
  const t = code.trim().toUpperCase();
  const m = /^AH-(\d+)/.exec(t);
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function computePaymentFlow(auto: CustomerBalanceStatus, debtUsdPositive: number): CustomerBalancePaymentFlow {
  if (debtUsdPositive > 0 && debtUsdPositive < LOW_DEBT_USD) return "LOW_DEBT";
  if (auto === "PAID") return "PAID";
  if (auto === "PARTIAL") return "PARTIAL";
  if (auto === "NOT_PAID") return "NOT_PAID";
  return "PARTIAL";
}

function parseIlsFilter(raw: string | undefined): number | null {
  const t = raw?.trim().replace(/,/g, "") ?? "";
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseUsdFilter(raw: string | undefined): number | null {
  return parseIlsFilter(raw);
}

function rowBalanceNumber(balanceIls: string): number {
  const n = Number(balanceIls.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowSignedIlsNumber(row: CustomerBalanceRow): number {
  const n = Number(row.signedIls.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowSignedUsdNumber(row: CustomerBalanceRow): number {
  const n = Number(row.signedUsd.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowBalanceUsdNumber(balanceUsd: string): number {
  const n = Number(balanceUsd.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowOrdersTotalNumber(totalOrdersUSD: string): number {
  const n = Number(totalOrdersUSD.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowPaymentsTotalNumber(totalPaymentsUSD: string): number {
  const n = Number(totalPaymentsUSD.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function matchesDebtFilter(row: CustomerBalanceRow, filter: CustomerBalanceDebtFilter): boolean {
  if (filter === "ALL") return true;
  const signed = rowSignedIlsNumber(row);
  const auto = row.autoStatus;
  const eps = 0.01;
  const businessBal = rowBalanceUsdNumber(row.totalBalanceUSD);
  if (filter === "OWES") return businessBal > eps;
  if (filter === "CREDIT") return businessBal < -eps;
  if (filter === "BALANCED") return Math.abs(businessBal) <= eps;
  if (filter === "PAID_FULL") return auto === "PAID" && Math.abs(signed) <= eps;
  if (filter === "PARTIAL") return auto === "PARTIAL";
  if (filter === "NOT_PAID") return auto === "NOT_PAID";
  if (filter === "LOW_BALANCE") {
    const u = rowSignedUsdNumber(row);
    return u < -eps && Math.abs(u) < LOW_DEBT_USD;
  }
  return true;
}

const ID_CHUNK = 4000;

let statusOverrideTableReady: Promise<void> | null = null;

async function findManyInChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    if (chunk.length === 0) continue;
    out.push(...(await fetchChunk(chunk)));
  }
  return out;
}

function buildCustomerWhere(query: CustomerBalanceQuery): Prisma.CustomerWhereInput {
  const f = query.filters;
  const smart = f?.smart?.trim();
  const base: Prisma.CustomerWhereInput = { deletedAt: null, isActive: true };
  const byId = query.customerId?.trim() ? { id: query.customerId.trim() } : {};

  if (smart) {
    return {
      ...base,
      ...byId,
      OR: [
        { displayName: { contains: smart, mode: "insensitive" } },
        { nameAr: { contains: smart, mode: "insensitive" } },
        { nameEn: { contains: smart, mode: "insensitive" } },
        { nameHe: { contains: smart, mode: "insensitive" } },
        { customerCode: { contains: smart, mode: "insensitive" } },
        { oldCustomerCode: { contains: smart, mode: "insensitive" } },
        { phone: { contains: smart, mode: "insensitive" } },
        { phone2: { contains: smart, mode: "insensitive" } },
        { country: { contains: smart, mode: "insensitive" } },
        ...(smart.length >= 2 ? [{ notes: { contains: smart, mode: "insensitive" as const } }] : []),
      ],
    };
  }

  return {
    ...base,
    ...byId,
    ...(f?.name?.trim()
      ? {
          OR: [
            { displayName: { contains: f.name.trim(), mode: "insensitive" as const } },
            { nameAr: { contains: f.name.trim(), mode: "insensitive" as const } },
            { nameEn: { contains: f.name.trim(), mode: "insensitive" as const } },
            { nameHe: { contains: f.name.trim(), mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(f?.code?.trim() ? { customerCode: { contains: f.code.trim(), mode: "insensitive" as const } } : {}),
    ...(f?.phone?.trim()
      ? {
          OR: [
            { phone: { contains: f.phone.trim(), mode: "insensitive" as const } },
            { phone2: { contains: f.phone.trim(), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

function emptyStatusBalanceKpis(): Record<StatusBalanceKpiKey, string> {
  const z = money(new Prisma.Decimal(0));
  return { open: z, ready: z, inProgress: z, debtWithdrawal: z };
}

function emptyBalancesPayload(limit: number): CustomerBalancesPayload {
  const z = money(new Prisma.Decimal(0));
  return {
    rows: [],
    page: 1,
    limit,
    totalRows: 0,
    totalPages: 1,
    stats: {
      totalDebtIls: z,
      totalCreditIls: z,
      totalPaymentsIls: z,
      totalDebtUsd: z,
      totalCreditUsd: z,
      totalPaymentsUsd: z,
      withDebtCount: 0,
      withCreditCount: 0,
      noDebtCount: 0,
      partialCount: 0,
      notPaidCount: 0,
      highDebtCount: 0,
      withPaymentsCount: 0,
      totalLifetimeOrdersUsd: z,
      totalOrdersAfterCommissionUsd: z,
      totalNetBalanceUsd: z,
    },
    statusBalanceKpis: emptyStatusBalanceKpis(),
    activeOrderStatusFilter: "ALL",
  };
}

function orderMatchesStatusFilter(status: string, statuses: string[] | null): boolean {
  return statuses == null || statuses.includes(status);
}

type OrderRowForStatusBalance = {
  customerId: string | null;
  status: string;
  debtWithdrawalUsd: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
};

function computeStatusBalanceKpis(params: {
  customerIds: string[];
  orderRows: OrderRowForStatusBalance[];
  receivedUsdByCustomer: Map<string, Prisma.Decimal>;
  creditUsdByCustomer: Map<string, Prisma.Decimal>;
}): Record<StatusBalanceKpiKey, string> {
  const paidUsd = (cid: string) => {
    const r = params.receivedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0);
    const c = params.creditUsdByCustomer.get(cid) ?? new Prisma.Decimal(0);
    return r.add(c);
  };
  const out: Record<StatusBalanceKpiKey, string> = emptyStatusBalanceKpis();
  for (const spec of STATUS_BALANCE_KPI_SPECS) {
    const statuses = orderStatusesForBalanceFilter(spec.filter);
    if (!statuses) continue;
    let sum = new Prisma.Decimal(0);
    for (const cid of params.customerIds) {
      let orders = new Prisma.Decimal(0);
      let withdrawals = new Prisma.Decimal(0);
      for (const o of params.orderRows) {
        if (o.customerId !== cid || !orderMatchesStatusFilter(o.status, statuses)) continue;
        if (isDebtWithdrawalOrderStatus(o.status)) {
          withdrawals = withdrawals.add(
            new Prisma.Decimal(orderCustomerCreditUsd(o).toFixed(4)),
          );
        } else {
          orders = orders.add(new Prisma.Decimal(orderCustomerChargeUsd(o).toFixed(4)));
        }
      }
      const bal = orders.sub(withdrawals).sub(paidUsd(cid));
      if (bal.gt(new Prisma.Decimal("0.01"))) sum = sum.add(bal);
    }
    out[spec.key] = money(sum);
  }
  return out;
}

function computeBalanceStats(rows: CustomerBalanceRow[]): CustomerBalancesPayload["stats"] {
  let totalDebt = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  let totalPayments = new Prisma.Decimal(0);
  let totalDebtUsd = new Prisma.Decimal(0);
  let totalCreditUsd = new Prisma.Decimal(0);
  let totalPaymentsUsd = new Prisma.Decimal(0);
  let withDebt = 0;
  let withCredit = 0;
  let noDebt = 0;
  let partial = 0;
  let notPaid = 0;
  let highDebt = 0;
  let withPayments = 0;
  let totalLifetimeOrdersUsd = new Prisma.Decimal(0);
  let totalOrdersAfterCommissionUsd = new Prisma.Decimal(0);
  let totalNetBalanceUsd = new Prisma.Decimal(0);
  const eps = 0.01;
  for (const r of rows) {
    const businessBal = rowBalanceUsdNumber(r.totalBalanceUSD);
    const businessBalUsd = rowBalanceUsdNumber(r.totalBalanceUSD);
    const signed = rowSignedIlsNumber(r);
    totalLifetimeOrdersUsd = totalLifetimeOrdersUsd.add(
      new Prisma.Decimal(rowBalanceUsdNumber(r.lifetimeOrdersUSD).toFixed(4)),
    );
    totalOrdersAfterCommissionUsd = totalOrdersAfterCommissionUsd.add(
      new Prisma.Decimal(rowOrdersTotalNumber(r.totalOrdersUSD).toFixed(4)),
    );
    totalNetBalanceUsd = totalNetBalanceUsd.add(new Prisma.Decimal(businessBalUsd.toFixed(4)));
    totalPayments = totalPayments.add(new Prisma.Decimal(rowPaymentsTotalNumber(r.totalPaymentsUSD).toFixed(4)));
    totalPaymentsUsd = totalPaymentsUsd.add(new Prisma.Decimal(rowBalanceUsdNumber(r.totalPaymentsUSD).toFixed(4)));
    if (businessBal > eps) {
      totalDebt = totalDebt.add(new Prisma.Decimal(businessBal.toFixed(4)));
      withDebt++;
      if (businessBal > HIGH_DEBT_ILS) highDebt++;
    } else if (businessBal < -eps) {
      totalCredit = totalCredit.add(new Prisma.Decimal(Math.abs(businessBal).toFixed(4)));
      withCredit++;
    } else {
      noDebt++;
    }
    if (businessBalUsd > eps) totalDebtUsd = totalDebtUsd.add(new Prisma.Decimal(businessBalUsd.toFixed(4)));
    else if (businessBalUsd < -eps) totalCreditUsd = totalCreditUsd.add(new Prisma.Decimal(Math.abs(businessBalUsd).toFixed(4)));
    if (r.autoStatus === "PARTIAL") partial++;
    if (r.autoStatus === "NOT_PAID" && businessBal > eps) notPaid++;
    if (rowPaymentsTotalNumber(r.totalPaymentsUSD) > eps) withPayments++;
  }
  return {
    totalDebtIls: money(totalDebt),
    totalCreditIls: money(totalCredit),
    totalPaymentsIls: money(totalPayments),
    totalDebtUsd: money(totalDebtUsd),
    totalCreditUsd: money(totalCreditUsd),
    totalPaymentsUsd: money(totalPaymentsUsd),
    withDebtCount: withDebt,
    withCreditCount: withCredit,
    noDebtCount: noDebt,
    partialCount: partial,
    notPaidCount: notPaid,
    highDebtCount: highDebt,
    withPaymentsCount: withPayments,
    totalLifetimeOrdersUsd: money(totalLifetimeOrdersUsd),
    totalOrdersAfterCommissionUsd: money(totalOrdersAfterCommissionUsd),
    totalNetBalanceUsd: money(totalNetBalanceUsd),
  };
}

export async function listCustomerBalancesAction(query: CustomerBalanceQuery): Promise<CustomerBalancesPayload> {
  noStore();
  console.log("[balances-report-query]", {
    week: query.weekCode?.trim() || null,
    country: query.sourceCountry?.trim() || null,
    from: query.fromYmd?.trim() || null,
    to: query.toYmd?.trim() || null,
  });
  logDbEnvDiagnostics("server /admin/balances listCustomerBalancesAction");
  const perfT0 = Date.now();
  let fetchCustomersMs = 0;
  let fetchOrdersMs = 0;
  let fetchPaymentsMs = 0;
  let customersQueryMs = 0;
  let customersTransformMs = 0;
  let ordersQueryMs = 0;
  let ordersTransformMs = 0;
  let paymentsQueryMs = 0;
  let paymentsTransformMs = 0;
  let statusOverrideSetupMs = 0;
  let calculateBalancesMs = 0;
  let calculateTotalsMs = 0;
  let renderMs = 0;
  let serializeMs = 0;
  let prismaQueryCount = 0;
  const prismaQueryBreakdown: Record<string, number> = {};

  const countPrismaQuery = (name: string) => {
    prismaQueryCount += 1;
    prismaQueryBreakdown[name] = (prismaQueryBreakdown[name] ?? 0) + 1;
  };
  const perfPrismaQuery = async <T>(
    name: string,
    setter: (ms: number) => void,
    work: () => Promise<T>,
  ): Promise<T> => {
    countPrismaQuery(name);
    if (!perfEnabled()) return work();
    const t0 = Date.now();
    try {
      return await work();
    } finally {
      setter(Date.now() - t0);
    }
  };

  const me = await requireAuth();
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 15)));
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return emptyBalancesPayload(limit);
  }

  const statusOverrideSetupWasCold = statusOverrideTableReady == null;
  const statusOverrideSetupT0 = Date.now();
  await ensureStatusOverrideTable();
  statusOverrideSetupMs = Date.now() - statusOverrideSetupT0;
  if (statusOverrideSetupWasCold) {
    countPrismaQuery("statusOverrideSetup.$executeRaw");
    countPrismaQuery("statusOverrideSetup.$executeRaw");
    countPrismaQuery("statusOverrideSetup.$executeRaw");
  }

  const lifetime = query.lifetime === true;
  const uptoNorm = normalizeAhWeekCode(query.uptoWeekCode?.trim() || null);
  const uptoRange = uptoNorm ? getAhWeekRange(uptoNorm) : null;
  const cumulativeThrough = uptoRange?.to ? endOfLocalDay(uptoRange.to) : null;
  const userToEnd = query.toYmd?.trim() ? endOfLocalDay(query.toYmd.trim()) : undefined;

  let orderDateFilter: Prisma.DateTimeFilter | undefined;
  let paymentDateFilter: Prisma.DateTimeFilter | undefined;

  if (lifetime) {
    /** דוח יתרות חי — תשלומים/הזמנות עד היום; toYmd ב-URL הוא תווית שבוע בלבד */
    const lteBound = endOfLocalDay(formatLocalYmd(new Date()));
    orderDateFilter = { lte: lteBound };
    paymentDateFilter = { lte: lteBound };
  } else if (cumulativeThrough) {
    const lteBound = userToEnd != null && userToEnd.getTime() < cumulativeThrough.getTime() ? userToEnd : cumulativeThrough;
    orderDateFilter = {
      ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
      lte: lteBound,
    };
    paymentDateFilter = {
      ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
      lte: lteBound,
    };
  } else if (query.fromYmd?.trim() || query.toYmd?.trim()) {
    let fromYmd = query.fromYmd?.trim() ?? "";
    let toYmd = query.toYmd?.trim() ?? "";
    if (fromYmd && toYmd) {
      const pair = normalizeYmdRangePair(fromYmd, toYmd);
      fromYmd = pair.from;
      toYmd = pair.to;
    }
    orderDateFilter = {
      ...(fromYmd ? { gte: parseLocalDate(fromYmd) } : {}),
      ...(toYmd ? { lte: endOfLocalDay(toYmd) } : {}),
    };
    paymentDateFilter = {
      ...(fromYmd ? { gte: parseLocalDate(fromYmd) } : {}),
      ...(toYmd ? { lte: endOfLocalDay(toYmd) } : {}),
    };
  }

  const countryNorm = normalizeOrderSourceCountry(query.sourceCountry || null);
  const orderCountryPrisma: OrderSourceCountry | undefined =
    countryNorm && (ORDER_COUNTRY_CODES as readonly string[]).includes(countryNorm)
      ? (countryNorm as OrderSourceCountry)
      : undefined;
  const countryScope = resolveCountryScopeFromCode(
    orderCountryPrisma ? workCountryFromOrderSourceCountry(orderCountryPrisma) : DEFAULT_WORK_COUNTRY,
  );

  const balancesReportLogBase = {
    week: query.weekCode?.trim() || null,
    country: countryScope.workCountry,
    sourceCountry: countryScope.sourceCountry,
    lifetime,
    fromYmd: query.fromYmd?.trim() || null,
    toYmd: query.toYmd?.trim() || null,
    orderStatusFilter: parseCustomerBalanceOrderStatusFilter(query.filters?.orderStatus),
  };

  const activeOrderStatusFilter = parseCustomerBalanceOrderStatusFilter(query.filters?.orderStatus);
  const orderStatusList = orderStatusesForBalanceFilter(activeOrderStatusFilter);

  const orderNestedWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    countryCode: countryScope.workCountry,
    sourceCountry: countryScope.sourceCountry,
    ...(!lifetime && !cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
  };

  const paymentLinkedWhere: Prisma.PaymentWhereInput = {
    ...activePaidPaymentWhere,
    countryCode: countryScope.workCountry,
    orderId: { not: null },
    ...(!lifetime && !cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
    order: {
      deletedAt: null,
      countryCode: countryScope.workCountry,
      sourceCountry: countryScope.sourceCountry,
    },
  };

  const customerWhere: Prisma.CustomerWhereInput = {
    ...buildCustomerWhere(query),
    countryCode: countryScope.workCountry,
  };
  const customers = await perfPrismaQuery("customers.findMany", (ms) => {
    fetchCustomersMs += ms;
    customersQueryMs += ms;
  }, () =>
    prisma.customer.findMany({
      where: customerWhere,
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        nameAr: true,
        nameEn: true,
        nameHe: true,
        customerCode: true,
      },
    }),
  );

  const customersTransformT0 = Date.now();
  const customerIds = customers.map((c) => c.id);
  customersTransformMs += Date.now() - customersTransformT0;
  if (customerIds.length === 0) {
    console.log("[balances-report]", {
      ...balancesReportLogBase,
      ordersFound: 0,
      paymentsFound: 0,
      balancesFound: 0,
      reason: "no_customers",
    });
    console.log({
      customersCount: 0,
      ordersCount: 0,
      paymentsCount: 0,
      balancesCount: 0,
    });
    if (perfEnabled()) {
      const totalMs = Date.now() - perfT0;
      console.table({
        fetchCustomersMs,
        fetchOrdersMs,
        fetchPaymentsMs,
        customersQueryMs,
        customersTransformMs,
        ordersQueryMs,
        ordersTransformMs,
        paymentsQueryMs,
        paymentsTransformMs,
        statusOverrideSetupMs,
        calculateBalancesMs,
        calculateTotalsMs,
        renderMs,
        serializeMs,
        totalMs,
      });
      console.log("[balances-report-prisma-query-count]", {
        prismaQueryCount,
        prismaQueryBreakdown,
        scope: "balances-report-data",
      });
    }
    return emptyBalancesPayload(limit);
  }
  const scopeFrom = orderDateFilter && "gte" in orderDateFilter ? (orderDateFilter.gte as Date | undefined) : undefined;
  const scopeTo = orderDateFilter && "lte" in orderDateFilter ? (orderDateFilter.lte as Date | undefined) : undefined;
  const sharedBalances = await calculateCustomerBalances(customerIds, {
    from: scopeFrom ?? null,
    to: scopeTo ?? null,
    sourceCountry: orderCountryPrisma ?? null,
    orderStatuses: orderStatusList,
    metrics: {
      onQuery: (kind, ms) => {
        countPrismaQuery(`calculateCustomerBalances.${kind}`);
        if (kind === "orders") {
          fetchOrdersMs += ms;
          ordersQueryMs += ms;
        } else {
          fetchPaymentsMs += ms;
          paymentsQueryMs += ms;
        }
      },
      onTransform: (kind, ms) => {
        if (kind === "orders") ordersTransformMs += ms;
        else paymentsTransformMs += ms;
      },
    },
  });

  // Business-only metric: lifetime (since day 1) sum of orders in USD, excluding debt withdrawals.
  const lifetimeAgg = await perfPrismaQuery("orders.lifetimeGroupBy", (ms) => {
    fetchOrdersMs += ms;
    ordersQueryMs += ms;
  }, () =>
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        deletedAt: null,
        customerId: { in: customerIds },
        status: { not: OS.DEBT_WITHDRAWAL },
        countryCode: countryScope.workCountry,
        sourceCountry: countryScope.sourceCountry,
      },
      _sum: { totalUsd: true },
    }),
  );
  const lifetimeTransformT0 = Date.now();
  const lifetimeOrdersUsdByCustomer = new Map(
    lifetimeAgg.map((r) => [r.customerId, (r._sum.totalUsd ?? new Prisma.Decimal(0)) as Prisma.Decimal]),
  );
  ordersTransformMs += Date.now() - lifetimeTransformT0;

  const orderSelect = {
    customerId: true,
    orderDate: true,
    weekCode: true,
    status: true,
    debtWithdrawalUsd: true,
    totalIlsWithVat: true,
    totalIls: true,
    totalUsd: true,
    amountUsd: true,
    amountIls: true,
    commissionUsd: true,
    commissionIls: true,
    usdRateUsed: true,
    snapshotFinalDollarRate: true,
    exchangeRate: true,
  } as const;

  const paymentSelect = {
    customerId: true,
    totalIlsWithVat: true,
    amountIls: true,
    amountUsd: true,
    exchangeRate: true,
  } as const;

  const [orderRows, paymentRows, generalCreditRows, overrides] = await Promise.all([
    findManyInChunks(customerIds, (chunk) =>
      perfPrismaQuery("orders.findMany", (ms) => {
        fetchOrdersMs += ms;
        ordersQueryMs += ms;
      }, () =>
        prisma.order.findMany({
          where: { ...orderNestedWhere, customerId: { in: chunk } },
          select: orderSelect,
        }),
      ),
    ),
    findManyInChunks(customerIds, (chunk) =>
      perfPrismaQuery("payments.linkedFindMany", (ms) => {
        fetchPaymentsMs += ms;
        paymentsQueryMs += ms;
      }, () =>
        prisma.payment.findMany({
          where: { ...paymentLinkedWhere, customerId: { in: chunk } },
          select: paymentSelect,
        }),
      ),
    ),
    findManyInChunks(customerIds, (chunk) =>
      perfPrismaQuery("payments.generalCreditFindMany", (ms) => {
        fetchPaymentsMs += ms;
        paymentsQueryMs += ms;
      }, () =>
        prisma.payment.findMany({
          where: {
            ...activePaidPaymentWhere,
            orderId: null,
            customerId: { in: chunk },
            countryCode: countryScope.workCountry,
            ...(!lifetime && !cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
            ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
          },
          select: {
            customerId: true,
            totalIlsWithVat: true,
            amountIls: true,
            amountUsd: true,
            exchangeRate: true,
          },
        }),
      ),
    ),
    customerIds.length > 0
      ? findManyInChunks(customerIds, (chunk) =>
          perfPrismaQuery("customerBalanceStatusOverride.findMany", (ms) => {
            fetchCustomersMs += ms;
            customersQueryMs += ms;
          }, () =>
            prisma.customerBalanceStatusOverride.findMany({
              where: { customerId: { in: chunk } },
              select: { customerId: true, statusOverride: true },
            }),
          ),
        )
      : Promise.resolve([] as Array<{ customerId: string; statusOverride: string | null }>),
  ]);

  const calcT0 = Date.now();
  const expectedIlsByCustomer = new Map<string, Prisma.Decimal>();
  const dealIlsByCustomer = new Map<string, Prisma.Decimal>();
  const commissionIlsByCustomer = new Map<string, Prisma.Decimal>();
  const orderCountByCustomer = new Map<string, number>();
  const expectedUsdByCustomer = new Map<string, Prisma.Decimal>();
  const receivedIlsByCustomer = new Map<string, Prisma.Decimal>();
  const receivedUsdByCustomer = new Map<string, Prisma.Decimal>();
  const maxAhByCustomer = new Map<string, number>();
  const lastOrderDateByCustomer = new Map<string, Date>();

  const orderRowsTransformT0 = Date.now();
  for (const o of orderRows) {
    const cid = o.customerId;
    if (!cid) continue;
    if (!orderMatchesStatusFilter(o.status, orderStatusList)) continue;
    const isWithdrawal = isDebtWithdrawalOrderStatus(o.status);
    const chargeUsd = orderCustomerChargeUsd(o);
    const creditUsd = orderCustomerCreditUsd(o);
    const v = isWithdrawal
      ? new Prisma.Decimal(0)
      : orderExpectedIlsValue(o);
    expectedIlsByCustomer.set(cid, (expectedIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(v));
    if (!isWithdrawal) {
      dealIlsByCustomer.set(cid, (dealIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(orderDealIlsValue(o)));
      commissionIlsByCustomer.set(
        cid,
        (commissionIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(orderCommissionIlsValue(o)),
      );
    }
    orderCountByCustomer.set(cid, (orderCountByCustomer.get(cid) ?? 0) + 1);
    if (chargeUsd > 0) {
      expectedUsdByCustomer.set(
        cid,
        (expectedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(chargeUsd.toFixed(4))),
      );
    }
    if (creditUsd > 0) {
      receivedUsdByCustomer.set(
        cid,
        (receivedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(creditUsd.toFixed(4))),
      );
      const rate = orderRate(o);
      if (rate) {
        const creditIls = new Prisma.Decimal(creditUsd).mul(rate).toDecimalPlaces(2, 4);
        receivedIlsByCustomer.set(
          cid,
          (receivedIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(creditIls),
        );
      }
    }
    const wn = ahWeekNumFromCode(o.weekCode);
    if (wn > 0) maxAhByCustomer.set(cid, Math.max(maxAhByCustomer.get(cid) ?? 0, wn));
    if (o.orderDate) {
      const od = new Date(o.orderDate);
      const prev = lastOrderDateByCustomer.get(cid);
      if (!prev || od.getTime() > prev.getTime()) lastOrderDateByCustomer.set(cid, od);
    }
  }
  ordersTransformMs += Date.now() - orderRowsTransformT0;

  const paymentRowsTransformT0 = Date.now();
  for (const p of paymentRows) {
    const cid = p.customerId;
    if (!cid) continue;
    const v = paymentIlsValue(p);
    receivedIlsByCustomer.set(cid, (receivedIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(v));
    receivedUsdByCustomer.set(cid, (receivedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(p.amountUsd ?? new Prisma.Decimal(0)));
  }

  const creditByCustomer = new Map<string, Prisma.Decimal>();
  const creditUsdByCustomer = new Map<string, Prisma.Decimal>();
  for (const p of generalCreditRows) {
    const cid = p.customerId ?? "";
    if (!cid) continue;
    const cur = creditByCustomer.get(cid) ?? new Prisma.Decimal(0);
    creditByCustomer.set(cid, cur.add(paymentIlsValue(p)));
    const curUsd = creditUsdByCustomer.get(cid) ?? new Prisma.Decimal(0);
    creditUsdByCustomer.set(cid, curUsd.add(p.amountUsd ?? new Prisma.Decimal(0)));
  }
  paymentsTransformMs += Date.now() - paymentRowsTransformT0;

  const overrideTransformT0 = Date.now();
  const overrideMap = new Map(
    overrides
      .filter((r) => r.statusOverride && STATUS_VALUES.has(r.statusOverride as CustomerBalanceStatus))
      .map((r) => [r.customerId, r.statusOverride as CustomerBalanceStatus]),
  );
  customersTransformMs += Date.now() - overrideTransformT0;

  const customerRowsTransformT0 = Date.now();
  const rows: CustomerBalanceRow[] = customers.map((c): CustomerBalanceRow => {
    const shared = sharedBalances.get(c.id);
    const expectedIls = expectedIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const receivedIls = receivedIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const creditsIls = creditByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const balanceIls = expectedIls.sub(receivedIls);
    const dealsIls = dealIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const commissionsIls = commissionIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const receiptsIls = receivedIls.add(creditsIls);
    const creditsUsd = creditUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const expectedUsd = shared?.totalOrders ?? expectedUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const paymentsUsdOnly = shared?.totalPayments ?? receivedUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const receivedUsd = shared
      ? shared.totalPayments.add(shared.totalWithdrawals)
      : receivedUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const signedIlsN = computeSignedFromTotals(
      Number(expectedIls.toFixed(4)),
      Number(receivedIls.toFixed(4)),
      Number(creditsIls.toFixed(4)),
    );
    const signedUsdN = computeSignedFromTotals(
      Number(expectedUsd.toFixed(4)),
      Number(receivedUsd.toFixed(4)),
      Number(creditsUsd.toFixed(4)),
    );
    const calculated = autoStatus(expectedIls, receivedIls);
    const override = overrideMap.get(c.id) ?? null;
    const oc = shared?.ordersCount ?? orderCountByCustomer.get(c.id) ?? 0;
    let balUsdDec =
      shared?.balance ??
      expectedUsd.sub(paymentsUsdOnly).sub(shared?.totalWithdrawals ?? new Prisma.Decimal(0));
    if (creditsUsd.gt(0)) {
      balUsdDec = balUsdDec.sub(creditsUsd);
    }
    if (balUsdDec.lt(0)) {
      balUsdDec = new Prisma.Decimal(0);
    }
    const debtUsdPos = balUsdDec.gt(0) ? Number(balUsdDec.toFixed(4)) : 0;
    const paymentFlow = computePaymentFlow(calculated, debtUsdPos);
    const lastDt = lastOrderDateByCustomer.get(c.id);
    const maxN = maxAhByCustomer.get(c.id) ?? 0;
    const lifetimeUsd = lifetimeOrdersUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    if (c.customerCode === "90006") {
      console.info("[getCustomerBalanceReport.balance]", {
        customerId: c.id,
        customerCode: c.customerCode,
        sourceCountry: orderCountryPrisma ?? null,
        fromYmd: query.fromYmd?.trim() || null,
        toYmd: query.toYmd?.trim() || null,
        ordersCount: shared?.ordersCount ?? oc,
        ordersTotal: (shared?.totalOrders ?? expectedUsd).toFixed(2),
        withdrawalsTotal: (shared?.totalWithdrawals ?? new Prisma.Decimal(0)).toFixed(2),
        paymentsTotal: (shared?.totalPayments ?? receivedUsd).toFixed(2),
        balance: balUsdDec.toFixed(2),
      });
    }
    return {
      customerId: c.id,
      customerName: primaryCustomerDisplayName({
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        nameHe: c.nameHe,
        displayName: c.displayName,
      }),
      customerCode: c.customerCode,
      lifetimeOrdersUSD: money(lifetimeUsd),
      ordersCount: oc,
      totalOrdersUSD: money(expectedUsd),
      totalPaymentsUSD: money(paymentsUsdOnly),
      totalBalanceUSD: money(balUsdDec),
      totalOrdersILS: money(expectedIls),
      totalPaymentsILS: money(receivedIls),
      totalDealsILS: money(dealsIls),
      totalCommissionsILS: money(commissionsIls),
      totalReceiptsILS: money(receiptsIls),
      totalBalanceILS: money(balanceIls),
      totalCreditsILS: money(creditsIls),
      noOrdersInRange: oc === 0,
      balanceILS: money(balanceIls),
      signedIls: money(new Prisma.Decimal(String(signedIlsN))),
      balanceUSD: money(balUsdDec),
      signedUsd: money(new Prisma.Decimal(String(signedUsdN))),
      expectedILS: money(expectedIls),
      receivedILS: money(receivedIls),
      status: override ?? calculated,
      autoStatus: calculated,
      statusOverride: override,
      paymentFlow,
      lastOrderYmd: lastDt ? formatLocalYmd(lastDt) : null,
      maxAhWeekNum: maxN,
    };
  });
  customersTransformMs += Date.now() - customerRowsTransformT0;
  calculateBalancesMs += Date.now() - calcT0;

  const debtFilter: CustomerBalanceDebtFilter =
    query.filters?.balanceDebtStatus && DEBT_FILTER_VALUES.has(query.filters.balanceDebtStatus)
      ? query.filters.balanceDebtStatus
      : "ALL";

  const minB = parseIlsFilter(query.filters?.minBalanceIls);
  const maxB = parseIlsFilter(query.filters?.maxBalanceIls);

  let filtered = rows.filter((r) => matchesDebtFilter(r, debtFilter));

  if (query.filters?.hasPayments) {
    const epsPay = 0.01;
    filtered = filtered.filter((r) => rowPaymentsTotalNumber(r.totalPaymentsUSD) > epsPay);
  }

  if (minB != null) filtered = filtered.filter((r) => rowBalanceUsdNumber(r.totalBalanceUSD) >= minB);
  if (maxB != null) filtered = filtered.filter((r) => rowBalanceUsdNumber(r.totalBalanceUSD) <= maxB);

  const curView = query.filters?.currencyView;
  if (curView === "ILS") {
    filtered = filtered.filter((r) => rowSignedIlsNumber(r) < -0.01);
  } else if (curView === "USD") {
    filtered = filtered.filter((r) => rowSignedUsdNumber(r) < -0.01);
  }

  let enrichMap: Map<string, CustomerOpenOrderEnrich> | null = null;
  let working: CustomerBalanceRow[] = filtered;

  if (query.enrichOpenOrders) {
    enrichMap = await fetchCustomerOpenOrderEnrichment({
      prisma,
      customerIds: filtered.map((r) => r.customerId),
      orderWhere: orderNestedWhere,
      paymentWhereLinked: paymentLinkedWhere,
      metrics: {
        onQuery: (kind, ms) => {
          countPrismaQuery(`openOrderEnrichment.${kind}`);
          if (kind === "orders") {
            fetchOrdersMs += ms;
            ordersQueryMs += ms;
          } else {
            fetchPaymentsMs += ms;
            paymentsQueryMs += ms;
          }
        },
        onTransform: (kind, ms) => {
          if (kind === "orders") ordersTransformMs += ms;
          else paymentsTransformMs += ms;
        },
      },
    });
    const emptyBuckets: Record<OrderPhaseUi, number> = { READY: 0, IN_PROGRESS: 0, PARTIAL: 0, DELAYED: 0 };
    working = filtered.map((r) => {
      const e = enrichMap!.get(r.customerId);
      if (!e) {
        return {
          ...r,
          ordersStatusSummary: "—",
          ordersOpenLines: [],
          orderPhaseBuckets: { ...emptyBuckets },
          orderRowHighlight: null,
        };
      }
      return {
        ...r,
        ordersStatusSummary: e.summary,
        ordersOpenLines: e.lines,
        orderPhaseBuckets: { ...e.buckets },
        orderRowHighlight: resolveOrderRowHighlight(e.hasReadyUnpaid, e.hasDelayed),
      };
    });

    const op =
      query.filters?.orderPhase && ORDER_PHASE_FILTER_VALUES.has(query.filters.orderPhase)
        ? query.filters.orderPhase
        : "ALL";
    if (op !== "ALL") {
      working = working.filter((r) => (r.orderPhaseBuckets?.[op as OrderPhaseUi] ?? 0) > 0);
    }
  }

  const minU = parseUsdFilter(query.filters?.minBalanceUsd);
  const maxU = parseUsdFilter(query.filters?.maxBalanceUsd);
  if (minU != null) working = working.filter((r) => rowBalanceUsdNumber(r.balanceUSD) >= minU);
  if (maxU != null) working = working.filter((r) => rowBalanceUsdNumber(r.balanceUSD) <= maxU);

  const sort: CustomerBalanceSort =
    query.filters?.sort && SORT_VALUES.has(query.filters.sort) ? query.filters.sort : "balance_desc";

  const statusBalanceKpis = computeStatusBalanceKpis({
    customerIds,
    orderRows,
    receivedUsdByCustomer,
    creditUsdByCustomer,
  });

  const totalsT0 = Date.now();
  const sorted = [...working].sort((a, b) => {
    if (sort === "balance_desc") return rowSignedIlsNumber(b) - rowSignedIlsNumber(a);
    if (sort === "balance_asc") return rowSignedIlsNumber(a) - rowSignedIlsNumber(b);
    if (sort === "orders_total") return rowOrdersTotalNumber(b.totalOrdersUSD) - rowOrdersTotalNumber(a.totalOrdersUSD);
    if (sort === "week_desc") return (b.maxAhWeekNum || 0) - (a.maxAhWeekNum || 0) || a.customerName.localeCompare(b.customerName, "he");
    if (sort === "week_asc") return (a.maxAhWeekNum || 0) - (b.maxAhWeekNum || 0) || a.customerName.localeCompare(b.customerName, "he");
    if (sort === "last_order_desc") {
      const ta = a.lastOrderYmd ? new Date(a.lastOrderYmd).getTime() : 0;
      const tb = b.lastOrderYmd ? new Date(b.lastOrderYmd).getTime() : 0;
      return tb - ta || rowSignedIlsNumber(b) - rowSignedIlsNumber(a);
    }
    if (sort === "last_order_asc") {
      const ta = a.lastOrderYmd ? new Date(a.lastOrderYmd).getTime() : 0;
      const tb = b.lastOrderYmd ? new Date(b.lastOrderYmd).getTime() : 0;
      return ta - tb || rowSignedIlsNumber(b) - rowSignedIlsNumber(a);
    }
    return a.customerName.localeCompare(b.customerName, "he");
  });

  const stats = computeBalanceStats(sorted);
  calculateTotalsMs += Date.now() - totalsT0;

  let reportModalStats: CustomerBalancesPayload["reportModalStats"] = undefined;
  if (query.enrichOpenOrders && enrichMap) {
    let totalDebtUsd = new Prisma.Decimal(0);
    let customersInTreatment = 0;
    let customersNoPayment = 0;
    let readyUnpaidOrdersCount = 0;
    for (const r of sorted) {
      const u = rowSignedUsdNumber(r);
      if (u < -0.01) totalDebtUsd = totalDebtUsd.add(new Prisma.Decimal(Math.abs(u).toFixed(4)));
      const e = enrichMap.get(r.customerId);
      if (e?.hasInProgress) customersInTreatment++;
      if (r.paymentFlow === "NOT_PAID") customersNoPayment++;
      if (e) readyUnpaidOrdersCount += e.readyUnpaidOrderCount;
    }
    const n = Number(totalDebtUsd.toString());
    reportModalStats = {
      totalDebtUsd: `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`,
      customersInTreatment,
      customersNoPayment,
      readyUnpaidOrdersCount,
    };
  }

  const requestedPage = Math.max(1, Math.floor(query.page || 1));
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;

  const out = {
    rows: sorted.slice(skip, skip + limit),
    page,
    limit,
    totalRows,
    totalPages,
    stats,
    statusBalanceKpis,
    activeOrderStatusFilter,
    ...(reportModalStats ? { reportModalStats } : {}),
  };

  console.log("[balances-report]", {
    ...balancesReportLogBase,
    ordersFound: orderRows.length,
    paymentsFound: paymentRows.length + generalCreditRows.length,
    balancesFound: sorted.length,
    debtFilter,
  });
  console.log({
    customersCount: customers.length,
    ordersCount: orderRows.length,
    paymentsCount: paymentRows.length + generalCreditRows.length,
    balancesCount: sorted.length,
  });

  if (perfEnabled()) {
    const totalMs = Date.now() - perfT0;
    console.table({
      fetchCustomersMs,
      fetchOrdersMs,
      fetchPaymentsMs,
      customersQueryMs,
      customersTransformMs,
      ordersQueryMs,
      ordersTransformMs,
      paymentsQueryMs,
      paymentsTransformMs,
      statusOverrideSetupMs,
      calculateBalancesMs,
      calculateTotalsMs,
      renderMs,
      serializeMs,
      totalMs,
    });
    console.log("[balances-report-prisma-query-count]", {
      prismaQueryCount,
      prismaQueryBreakdown,
      scope: "balances-report-data",
    });
  }

  return out;
}

export type CustomerBalanceReportModalInput = {
  page: number;
  limit?: number;
  smart?: string;
  orderPhase?: CustomerBalanceOrderPhaseFilter;
  minBalanceIls?: string;
  maxBalanceIls?: string;
  minBalanceUsd?: string;
  maxBalanceUsd?: string;
  /** דורס את שבוע העבודה מהדוח הראשי כשמוזן */
  modalWeekCode?: string;
  /** דורס את תאריך הסיום מהדוח הראשי */
  modalToYmd?: string;
};

/** נתונים למודאל "יתרות לקוחות" בדוחות — כולל סטטוס הזמנות פתוחות ו־KPI */
export async function listCustomerBalancesReportModalAction(
  reportFilters: {
    dateFrom?: string;
    dateTo?: string;
    workWeek?: string;
    sourceCountry?: string;
    customerId?: string;
  },
  modal: CustomerBalanceReportModalInput,
): Promise<CustomerBalancesPayload> {
  const limit = Math.min(50, Math.max(1, Math.floor(modal.limit ?? 20)));
  return listCustomerBalancesAction({
    page: modal.page,
    limit,
    fromYmd: reportFilters.dateFrom,
    toYmd: modal.modalToYmd?.trim() || reportFilters.dateTo,
    weekCode: modal.modalWeekCode?.trim() || reportFilters.workWeek,
    sourceCountry: (reportFilters.sourceCountry as OrderCountryCode) || "",
    customerId: reportFilters.customerId?.trim(),
    enrichOpenOrders: true,
    filters: {
      smart: modal.smart,
      orderPhase: modal.orderPhase ?? "ALL",
      balanceDebtStatus: "ALL",
      minBalanceIls: modal.minBalanceIls,
      maxBalanceIls: modal.maxBalanceIls,
      minBalanceUsd: modal.minBalanceUsd,
      maxBalanceUsd: modal.maxBalanceUsd,
      sort: "balance_desc",
    },
  });
}

export async function updateCustomerBalanceStatusAction(
  customerId: string,
  status: CustomerBalanceStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  if (!STATUS_VALUES.has(status)) return { ok: false, error: "סטטוס לא תקין" };

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "statusOverride", "updatedAt")
    VALUES (${id}, ${status}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "statusOverride" = EXCLUDED."statusOverride", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}

export async function updateCustomerBalanceNoteAction(
  customerId: string,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return { ok: false, error: "אין הרשאה" };

  const id = customerId.trim();
  if (!id) return { ok: false, error: "לקוח לא נמצא" };
  const clean = note.trim() || null;

  await ensureStatusOverrideTable();
  await prisma.$executeRaw`
    INSERT INTO "CustomerBalanceStatusOverride" ("customerId", "note", "updatedAt")
    VALUES (${id}, ${clean}, CURRENT_TIMESTAMP)
    ON CONFLICT ("customerId")
    DO UPDATE SET "note" = EXCLUDED."note", "updatedAt" = CURRENT_TIMESTAMP
  `;

  return { ok: true };
}

export type CustomerBalancePreview = {
  phone: string;
  city: string;
  ordersCount: number;
  lastPaymentLabel: string;
  balanceIls: string;
};

export async function getCustomerBalancePreviewAction(
  customerId: string,
  balanceIls: string,
  ordersCount: number,
): Promise<CustomerBalancePreview | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) return null;

  const id = customerId.trim();
  if (!id) return null;

  const [customer, lastPay] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: { phone: true, phone2: true, city: true },
    }),
    prisma.payment.findFirst({
      where: { customerId: id, ...activePaidPaymentWhere },
      orderBy: { paymentDate: "desc" },
      select: {
        paymentCode: true,
        paymentDate: true,
        totalIlsWithVat: true,
        amountIls: true,
        amountUsd: true,
        exchangeRate: true,
      },
    }),
  ]);

  if (!customer) return null;

  const phone = [customer.phone, customer.phone2].filter(Boolean).join(" · ") || "—";
  let lastPaymentLabel = "—";
  if (lastPay) {
    const amt = money(lastPay.amountUsd ?? new Prisma.Decimal(0));
    const code = lastPay.paymentCode?.trim() || "—";
    const dt = lastPay.paymentDate ? formatLocalYmd(lastPay.paymentDate) : "";
    lastPaymentLabel = dt ? `${code} · ${dt} · $${amt}` : `${code} · $${amt}`;
  }

  return {
    phone,
    city: customer.city?.trim() || "—",
    ordersCount,
    lastPaymentLabel,
    balanceIls,
  };
}

export type CustomerBalancesExportKind = "excel" | "pdf";

export async function exportCustomerBalancesAction(
  query: CustomerBalanceQuery,
  kind: CustomerBalancesExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_reports"])) {
      return { ok: false, error: "אין הרשאה" };
    }

    const payload = await listCustomerBalancesAction({ ...query, page: 1, limit: 10000 });
    if (payload.rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = ["קוד לקוח", "שם לקוח", "סה\"כ הזמנות מצטבר ($)", "סה\"כ הזמנות ($)", "סה\"כ תשלומים ($)", "יתרה ($)", "סטטוס"];
    const data = payload.rows.map((r) => {
      const b = rowBalanceUsdNumber(r.totalBalanceUSD);
      const status = b > 0.01 ? "חייב" : b < -0.01 ? "זכות" : "מאוזן";
      return [
        r.customerCode ?? "—",
        r.customerName,
        r.lifetimeOrdersUSD,
        r.totalOrdersUSD,
        r.totalPaymentsUSD,
        r.totalBalanceUSD,
        status,
      ];
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`דוח יתרות לקוחות · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `balances_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildAtlasExportHtml } = await import("@/lib/atlas-export-html");
    let ordersSum = 0;
    let paymentsSum = 0;
    let balanceSum = 0;
    for (const r of payload.rows) {
      ordersSum += rowOrdersTotalNumber(r.totalOrdersUSD);
      paymentsSum += rowPaymentsTotalNumber(r.totalPaymentsUSD);
      balanceSum += Math.max(0, rowBalanceUsdNumber(r.totalBalanceUSD));
    }
    const html = buildAtlasExportHtml({
      title: `דוח יתרות לקוחות · ${stamp}`,
      reportKind: "balances",
      headers,
      rows: data,
      meta: { extraMeta: `הופק: ${stamp} · ${payload.rows.length} לקוחות` },
      footer: {
        ordersTotalUsd: money(new Prisma.Decimal(ordersSum.toFixed(4))),
        paymentsTotalUsd: money(new Prisma.Decimal(paymentsSum.toFixed(4))),
        balanceUsd: money(new Prisma.Decimal(balanceSum.toFixed(4))),
      },
    });
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `balances_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
