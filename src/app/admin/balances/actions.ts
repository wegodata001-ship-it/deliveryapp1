"use server";

import { OrderSourceCountry, Prisma } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import { endOfLocalDay, formatLocalYmd, getAhWeekRange, normalizeAhWeekCode, parseLocalDate } from "@/lib/work-week";
import { ORDER_COUNTRY_CODES, normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  fetchCustomerOpenOrderEnrichment,
  resolveOrderRowHighlight,
  type CustomerOpenOrderLine,
  type CustomerOpenOrderEnrich,
  type OrderPhaseUi,
} from "@/lib/customer-balance-order-status";

export type CustomerBalanceStatus = "NOT_PAID" | "PARTIAL" | "PAID" | "PROBLEM" | "PAUSED";

/** סינון לפי סטטוס הזמנות פתוחות (מודאל דוחות) */
export type CustomerBalanceOrderPhaseFilter = "ALL" | OrderPhaseUi;

/** סינון לפי מצב יתרה (חישוב), לא לפי סטטוס גבייה */
export type CustomerBalanceDebtFilter = "ALL" | "OWES" | "PAID_FULL" | "PARTIAL" | "NOT_PAID" | "LOW_BALANCE";

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
  filters?: CustomerBalanceFilters;
};

export type CustomerBalanceRow = {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  /** מספר הזמנות שנכנסו לחישוב בטווח */
  ordersCount: number;
  totalOrdersILS: string;
  totalPaymentsILS: string;
  totalCreditsILS: string;
  noOrdersInRange: boolean;
  balanceILS: string;
  balanceUSD: string;
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
    withDebtCount: number;
    noDebtCount: number;
    partialCount: number;
    notPaidCount: number;
    /** חוב בש״ח מעל סף (תצוגה בלבד) */
    highDebtCount: number;
  };
  /** KPI נוספים למודאל דוח יתרות (לפי אותה קבוצה מסוננת לפני pagination) */
  reportModalStats?: {
    totalDebtUsd: string;
    customersInTreatment: number;
    customersNoPayment: number;
    readyUnpaidOrdersCount: number;
  };
};

const STATUS_VALUES = new Set<CustomerBalanceStatus>(["NOT_PAID", "PARTIAL", "PAID", "PROBLEM", "PAUSED"]);

const DEBT_FILTER_VALUES = new Set<CustomerBalanceDebtFilter>([
  "ALL",
  "OWES",
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

function orderExpectedIlsValue(o: {
  totalIlsWithVat: Prisma.Decimal | null;
  totalIls: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  usdRateUsed: Prisma.Decimal | null;
  snapshotFinalDollarRate: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalIlsWithVat) return o.totalIlsWithVat;
  if (o.totalIls) return o.totalIls;
  const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
  const rate = o.usdRateUsed ?? o.snapshotFinalDollarRate ?? o.exchangeRate;
  return rate ? usd.mul(rate) : new Prisma.Decimal(0);
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
  const t = raw?.trim().replace(",", ".") ?? "";
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

function rowBalanceUsdNumber(balanceUsd: string): number {
  const n = Number(balanceUsd.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function rowOrdersTotalNumber(totalOrdersILS: string): number {
  const n = Number(totalOrdersILS.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function matchesDebtFilter(row: CustomerBalanceRow, filter: CustomerBalanceDebtFilter): boolean {
  if (filter === "ALL") return true;
  const bal = rowBalanceNumber(row.balanceILS);
  const auto = row.autoStatus;
  const eps = 0.01;
  if (filter === "OWES") return bal > eps;
  if (filter === "PAID_FULL") return auto === "PAID" && Math.abs(bal) <= eps;
  if (filter === "PARTIAL") return auto === "PARTIAL";
  if (filter === "NOT_PAID") return auto === "NOT_PAID";
  if (filter === "LOW_BALANCE") {
    const u = Number(row.balanceUSD.replace(",", "."));
    return Number.isFinite(u) && u > 0 && u < LOW_DEBT_USD && bal > eps;
  }
  return true;
}

const ID_CHUNK = 2000;

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
        { secondPhone: { contains: smart, mode: "insensitive" } },
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
            { secondPhone: { contains: f.phone.trim(), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
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
      withDebtCount: 0,
      noDebtCount: 0,
      partialCount: 0,
      notPaidCount: 0,
      highDebtCount: 0,
    },
  };
}

function computeBalanceStats(rows: CustomerBalanceRow[]): CustomerBalancesPayload["stats"] {
  let totalDebt = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  let withDebt = 0;
  let noDebt = 0;
  let partial = 0;
  let notPaid = 0;
  let highDebt = 0;
  const eps = 0.01;
  for (const r of rows) {
    const bal = new Prisma.Decimal(rowBalanceNumber(r.balanceILS));
    if (bal.gt(eps)) {
      totalDebt = totalDebt.add(bal);
      withDebt++;
      if (bal.gt(HIGH_DEBT_ILS)) highDebt++;
    } else {
      noDebt++;
    }
    if (bal.lt(-eps)) {
      totalCredit = totalCredit.add(bal.abs());
    }
    if (r.autoStatus === "PARTIAL") partial++;
    if (r.autoStatus === "NOT_PAID" && bal.gt(eps)) notPaid++;
  }
  return {
    totalDebtIls: money(totalDebt),
    totalCreditIls: money(totalCredit),
    withDebtCount: withDebt,
    noDebtCount: noDebt,
    partialCount: partial,
    notPaidCount: notPaid,
    highDebtCount: highDebt,
  };
}

export async function listCustomerBalancesAction(query: CustomerBalanceQuery): Promise<CustomerBalancesPayload> {
  const me = await requireAuth();
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 15)));
  if (!userHasAnyPermission(me, ["view_reports"])) {
    return emptyBalancesPayload(limit);
  }

  await ensureStatusOverrideTable();

  const uptoNorm = normalizeAhWeekCode(query.uptoWeekCode?.trim() || null);
  const uptoRange = uptoNorm ? getAhWeekRange(uptoNorm) : null;
  const cumulativeThrough = uptoRange?.to ? endOfLocalDay(uptoRange.to) : null;
  const userToEnd = query.toYmd?.trim() ? endOfLocalDay(query.toYmd.trim()) : undefined;

  let orderDateFilter: Prisma.DateTimeFilter | undefined;
  let paymentDateFilter: Prisma.DateTimeFilter | undefined;

  if (cumulativeThrough) {
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
    orderDateFilter = {
      ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
      ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
    };
    paymentDateFilter = {
      ...(query.fromYmd?.trim() ? { gte: parseLocalDate(query.fromYmd.trim()) } : {}),
      ...(query.toYmd?.trim() ? { lte: endOfLocalDay(query.toYmd.trim()) } : {}),
    };
  }

  const countryNorm = normalizeOrderSourceCountry(query.sourceCountry || null);
  const orderCountryPrisma: OrderSourceCountry | undefined =
    countryNorm && (ORDER_COUNTRY_CODES as readonly string[]).includes(countryNorm) ? (countryNorm as OrderSourceCountry) : undefined;

  const orderNestedWhere: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...(!cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
    ...(orderCountryPrisma ? { sourceCountry: orderCountryPrisma } : {}),
  };

  const paymentLinkedWhere: Prisma.PaymentWhereInput = {
    isPaid: true,
    orderId: { not: null },
    ...(!cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
    ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
    ...(orderCountryPrisma
      ? {
          order: {
            deletedAt: null,
            sourceCountry: orderCountryPrisma,
          },
        }
      : {}),
  };

  const customerWhere = buildCustomerWhere(query);

  const customers = await prisma.customer.findMany({
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
  });

  const customerIds = customers.map((c) => c.id);
  if (customerIds.length === 0) {
    return emptyBalancesPayload(limit);
  }

  const orderSelect = {
    customerId: true,
    orderDate: true,
    weekCode: true,
    totalIlsWithVat: true,
    totalIls: true,
    totalUsd: true,
    amountUsd: true,
    commissionUsd: true,
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
      prisma.order.findMany({
        where: { ...orderNestedWhere, customerId: { in: chunk } },
        select: orderSelect,
      }),
    ),
    findManyInChunks(customerIds, (chunk) =>
      prisma.payment.findMany({
        where: { ...paymentLinkedWhere, customerId: { in: chunk } },
        select: paymentSelect,
      }),
    ),
    findManyInChunks(customerIds, (chunk) =>
      prisma.payment.findMany({
        where: {
          isPaid: true,
          orderId: null,
          customerId: { in: chunk },
          ...(!cumulativeThrough && query.weekCode?.trim() ? { weekCode: query.weekCode.trim() } : {}),
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
    prisma.$queryRaw<Array<{ customerId: string; statusOverride: string | null }>>`
      SELECT "customerId", "statusOverride"
      FROM "CustomerBalanceStatusOverride"
    `,
  ]);

  const expectedIlsByCustomer = new Map<string, Prisma.Decimal>();
  const orderCountByCustomer = new Map<string, number>();
  const expectedUsdByCustomer = new Map<string, Prisma.Decimal>();
  const maxAhByCustomer = new Map<string, number>();
  const lastOrderDateByCustomer = new Map<string, Date>();

  for (const o of orderRows) {
    const cid = o.customerId;
    if (!cid) continue;
    const v = orderExpectedIlsValue(o);
    expectedIlsByCustomer.set(cid, (expectedIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(v));
    orderCountByCustomer.set(cid, (orderCountByCustomer.get(cid) ?? 0) + 1);
    const usd = o.totalUsd ?? (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
    expectedUsdByCustomer.set(cid, (expectedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(usd));
    const wn = ahWeekNumFromCode(o.weekCode);
    if (wn > 0) maxAhByCustomer.set(cid, Math.max(maxAhByCustomer.get(cid) ?? 0, wn));
    if (o.orderDate) {
      const od = new Date(o.orderDate);
      const prev = lastOrderDateByCustomer.get(cid);
      if (!prev || od.getTime() > prev.getTime()) lastOrderDateByCustomer.set(cid, od);
    }
  }

  const receivedIlsByCustomer = new Map<string, Prisma.Decimal>();
  const receivedUsdByCustomer = new Map<string, Prisma.Decimal>();
  for (const p of paymentRows) {
    const cid = p.customerId;
    if (!cid) continue;
    const v = paymentIlsValue(p);
    receivedIlsByCustomer.set(cid, (receivedIlsByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(v));
    receivedUsdByCustomer.set(cid, (receivedUsdByCustomer.get(cid) ?? new Prisma.Decimal(0)).add(p.amountUsd ?? new Prisma.Decimal(0)));
  }

  const creditByCustomer = new Map<string, Prisma.Decimal>();
  for (const p of generalCreditRows) {
    const cid = p.customerId ?? "";
    if (!cid) continue;
    const cur = creditByCustomer.get(cid) ?? new Prisma.Decimal(0);
    creditByCustomer.set(cid, cur.add(paymentIlsValue(p)));
  }

  const overrideMap = new Map(
    overrides
      .filter((r) => r.statusOverride && STATUS_VALUES.has(r.statusOverride as CustomerBalanceStatus))
      .map((r) => [r.customerId, r.statusOverride as CustomerBalanceStatus]),
  );

  const rows: CustomerBalanceRow[] = customers.map((c): CustomerBalanceRow => {
    const expectedIls = expectedIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const receivedIls = receivedIlsByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const creditsIls = creditByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const balanceIls = expectedIls.sub(receivedIls);
    const expectedUsd = expectedUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const receivedUsd = receivedUsdByCustomer.get(c.id) ?? new Prisma.Decimal(0);
    const calculated = autoStatus(expectedIls, receivedIls);
    const override = overrideMap.get(c.id) ?? null;
    const oc = orderCountByCustomer.get(c.id) ?? 0;
    const balUsdDec = expectedUsd.sub(receivedUsd);
    const debtUsdPos = balUsdDec.gt(0) ? Number(balUsdDec.toFixed(4)) : 0;
    const paymentFlow = computePaymentFlow(calculated, debtUsdPos);
    const lastDt = lastOrderDateByCustomer.get(c.id);
    const maxN = maxAhByCustomer.get(c.id) ?? 0;
    return {
      customerId: c.id,
      customerName: primaryCustomerDisplayName({
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        nameHe: c.nameHe,
        displayName: c.displayName,
      }),
      customerCode: c.customerCode,
      ordersCount: oc,
      totalOrdersILS: money(expectedIls),
      totalPaymentsILS: money(receivedIls),
      totalCreditsILS: money(creditsIls),
      noOrdersInRange: oc === 0,
      balanceILS: money(balanceIls),
      balanceUSD: money(expectedUsd.sub(receivedUsd)),
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

  const debtFilter: CustomerBalanceDebtFilter =
    query.filters?.balanceDebtStatus && DEBT_FILTER_VALUES.has(query.filters.balanceDebtStatus)
      ? query.filters.balanceDebtStatus
      : "ALL";

  const minB = parseIlsFilter(query.filters?.minBalanceIls);
  const maxB = parseIlsFilter(query.filters?.maxBalanceIls);

  let filtered = rows.filter((r) => matchesDebtFilter(r, debtFilter));

  if (minB != null) filtered = filtered.filter((r) => rowBalanceNumber(r.balanceILS) >= minB);
  if (maxB != null) filtered = filtered.filter((r) => rowBalanceNumber(r.balanceILS) <= maxB);

  const curView = query.filters?.currencyView;
  if (curView === "ILS") {
    filtered = filtered.filter((r) => rowBalanceNumber(r.balanceILS) > 0.01);
  } else if (curView === "USD") {
    filtered = filtered.filter((r) => {
      const u = Number(r.balanceUSD.replace(",", "."));
      return Number.isFinite(u) && u > 0.01;
    });
  }

  let enrichMap: Map<string, CustomerOpenOrderEnrich> | null = null;
  let working: CustomerBalanceRow[] = filtered;

  if (query.enrichOpenOrders) {
    enrichMap = await fetchCustomerOpenOrderEnrichment({
      prisma,
      customerIds: filtered.map((r) => r.customerId),
      orderWhere: orderNestedWhere,
      paymentWhereLinked: paymentLinkedWhere,
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

  const sorted = [...working].sort((a, b) => {
    if (sort === "balance_desc") return rowBalanceNumber(b.balanceILS) - rowBalanceNumber(a.balanceILS);
    if (sort === "balance_asc") return rowBalanceNumber(a.balanceILS) - rowBalanceNumber(b.balanceILS);
    if (sort === "orders_total") return rowOrdersTotalNumber(b.totalOrdersILS) - rowOrdersTotalNumber(a.totalOrdersILS);
    if (sort === "week_desc") return (b.maxAhWeekNum || 0) - (a.maxAhWeekNum || 0) || a.customerName.localeCompare(b.customerName, "he");
    if (sort === "week_asc") return (a.maxAhWeekNum || 0) - (b.maxAhWeekNum || 0) || a.customerName.localeCompare(b.customerName, "he");
    if (sort === "last_order_desc") {
      const ta = a.lastOrderYmd ? new Date(a.lastOrderYmd).getTime() : 0;
      const tb = b.lastOrderYmd ? new Date(b.lastOrderYmd).getTime() : 0;
      return tb - ta || rowBalanceNumber(b.balanceILS) - rowBalanceNumber(a.balanceILS);
    }
    if (sort === "last_order_asc") {
      const ta = a.lastOrderYmd ? new Date(a.lastOrderYmd).getTime() : 0;
      const tb = b.lastOrderYmd ? new Date(b.lastOrderYmd).getTime() : 0;
      return ta - tb || rowBalanceNumber(b.balanceILS) - rowBalanceNumber(a.balanceILS);
    }
    return a.customerName.localeCompare(b.customerName, "he");
  });

  const stats = computeBalanceStats(sorted);

  let reportModalStats: CustomerBalancesPayload["reportModalStats"] = undefined;
  if (query.enrichOpenOrders && enrichMap) {
    let totalDebtUsd = new Prisma.Decimal(0);
    let customersInTreatment = 0;
    let customersNoPayment = 0;
    let readyUnpaidOrdersCount = 0;
    for (const r of sorted) {
      const u = rowBalanceUsdNumber(r.balanceUSD);
      if (u > 0.01) totalDebtUsd = totalDebtUsd.add(new Prisma.Decimal(u.toFixed(4)));
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

  return {
    rows: sorted.slice(skip, skip + limit),
    page,
    limit,
    totalRows,
    totalPages,
    stats,
    ...(reportModalStats ? { reportModalStats } : {}),
  };
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
      balanceDebtStatus: "OWES",
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
