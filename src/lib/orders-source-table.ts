import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { normalizeOrderSourceCountry, orderCountryLabel } from "@/lib/order-countries";
import { getOrderStatusLabelMap } from "@/lib/order-status-registry";
import { OS } from "@/lib/order-status-slugs";
import { prisma } from "@/lib/prisma";
import { ordersPerfEnd, ordersPerfRun, ordersPerfStart } from "@/lib/orders-source-perf";
import { orderWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WEEK_CODE, formatLocalYmd } from "@/lib/work-week";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  POINT: "נקודת תשלום",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  CASH: "מזומן",
  CHECK: "צ׳ק",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

export type OrderStatusOption = { value: string; label: string };

export type OrdersSourceFilters = {
  search?: string;
  orderNumber?: string;
  customer?: string;
  country?: string;
  /** סביבת עבודה — אין ערבוב בין מדינות */
  workCountry?: WorkCountryCode;
  weekCode?: string;
  status?: string;
  fromYmd?: string;
  toYmd?: string;
};

export type OrdersSourceListQuery = {
  page?: number;
  limit?: number;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  filters?: OrdersSourceFilters;
};

export type OrderSourceRowTone = "new" | "progress" | "done" | "cancelled" | "neutral";

export type OrdersSourceRow = {
  id: string;
  orderNumber: string;
  weekCode: string;
  customerName: string;
  customerId: string;
  country: string;
  countryCode: string;
  orderDateYmd: string;
  usd: string;
  ils: string;
  paymentLabel: string;
  statusId: string;
  statusLabel: string;
  tone: OrderSourceRowTone;
};

export type OrdersSourceListResult = {
  rows: OrdersSourceRow[];
  page: number;
  limit: number;
  hasMore: boolean;
  statusOptions: OrderStatusOption[];
};

export type OrdersSourceKpis = {
  totalOrders: number;
  totalUsd: string;
  activeCountries: number;
  weekOrders: number;
  weekCode: string;
};

export type OrdersSourcePreview = {
  id: string;
  orderNumber: string;
  customerName: string;
  country: string;
  orderDateYmd: string;
  usd: string;
  ils: string;
  statusLabel: string;
  paymentCode: string;
  paymentMethod: string;
  notes: string;
};

function parseYmdStart(ymd: string): Date {
  return new Date(`${ymd.trim()}T00:00:00`);
}

function parseYmdEnd(ymd: string): Date {
  return new Date(`${ymd.trim()}T23:59:59.999`);
}

function fmtMoney(n: unknown): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function countryLabel(code: string | null | undefined): { label: string; code: string } {
  const norm = normalizeOrderSourceCountry(code);
  if (!norm) return { label: "—", code: "" };
  return { label: orderCountryLabel(norm), code: norm };
}

export function orderStatusTone(statusId: string): OrderSourceRowTone {
  if (statusId === OS.COMPLETED) return "done";
  if (statusId === OS.CANCELLED) return "cancelled";
  if (statusId === OS.OPEN) return "new";
  if (statusId.startsWith("WAITING") || statusId === OS.SENT || statusId === OS.WITHDRAWAL_FROM_SUPPLIER) {
    return "progress";
  }
  return "neutral";
}

export function buildOrdersSourceWhere(filters: OrdersSourceFilters = {}): Prisma.OrderWhereInput {
  const search = filters.search?.trim() ?? "";
  ordersPerfStart("orders.filters");
  try {
    const and: Prisma.OrderWhereInput[] = [{ deletedAt: null }];

    const wc = filters.workCountry ?? DEFAULT_WORK_COUNTRY;
    and.push(orderWhereForCountryScope(resolveCountryScopeFromCode(wc)));

    const status = filters.status?.trim();
    if (status) and.push({ status });

    const week = filters.weekCode?.trim();
    if (week) and.push({ weekCode: week });

    const country = normalizeOrderSourceCountry(filters.country);
    if (country) and.push({ sourceCountry: country });

    const orderNum = filters.orderNumber?.trim();
    if (orderNum) {
      and.push({
        OR: [
          { orderNumber: { contains: orderNum, mode: "insensitive" } },
          { oldOrderNumber: { contains: orderNum, mode: "insensitive" } },
        ],
      });
    }

    const customer = filters.customer?.trim();
    if (customer) {
      and.push({
        OR: [
          { customerNameSnapshot: { contains: customer, mode: "insensitive" } },
          { customerCodeSnapshot: { contains: customer, mode: "insensitive" } },
        ],
      });
    }

    if (filters.fromYmd?.trim()) {
      and.push({ orderDate: { gte: parseYmdStart(filters.fromYmd) } });
    }
    if (filters.toYmd?.trim()) {
      and.push({ orderDate: { lte: parseYmdEnd(filters.toYmd) } });
    }

    if (search && !orderNum && !customer) {
      and.push({
        OR: [
          { orderNumber: { contains: search, mode: "insensitive" } },
          { oldOrderNumber: { contains: search, mode: "insensitive" } },
          { weekCode: { contains: search, mode: "insensitive" } },
          { customerNameSnapshot: { contains: search, mode: "insensitive" } },
          { customerCodeSnapshot: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return and.length === 1 ? and[0]! : { AND: and };
  } finally {
    ordersPerfEnd("orders.filters");
  }
}

function orderByFromQuery(query: OrdersSourceListQuery): Prisma.OrderOrderByWithRelationInput {
  const sortKey = query.sortKey?.trim();
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  switch (sortKey) {
    case "order":
      return { orderNumber: sortDir };
    case "week":
      return { weekCode: sortDir };
    case "customer":
      return { customerNameSnapshot: sortDir };
    case "country":
      return { sourceCountry: sortDir };
    case "usd":
      return { totalUsd: sortDir };
    case "ils":
      return { totalIlsWithVat: sortDir };
    case "status":
      return { status: sortDir };
    case "date":
      return { orderDate: sortDir };
    default:
      return { createdAt: "desc" };
  }
}

const orderListSelect = {
  id: true,
  orderNumber: true,
  weekCode: true,
  customerId: true,
  customerNameSnapshot: true,
  sourceCountry: true,
  orderDate: true,
  totalUsd: true,
  totalIlsWithVat: true,
  status: true,
  paymentMethod: true,
} as const;

async function loadStatusOptions(): Promise<OrderStatusOption[]> {
  const labelMap = await getOrderStatusLabelMap();
  return Object.entries(labelMap).map(([value, label]) => ({ value, label }));
}

export const getOrderStatusOptionsCached = unstable_cache(
  () => loadStatusOptions(),
  ["orders-source-status-options"],
  { revalidate: 300 },
);

function mapOrderRow(
  r: Prisma.OrderGetPayload<{ select: typeof orderListSelect }>,
  labels: Record<string, string>,
): OrdersSourceRow {
  const c = countryLabel(r.sourceCountry);
  const statusId = r.status;
  const pm = r.paymentMethod;
  return {
    id: r.id,
    orderNumber: r.orderNumber ?? "—",
    weekCode: r.weekCode ?? "—",
    customerName: r.customerNameSnapshot ?? "—",
    customerId: r.customerId ?? "",
    country: c.label,
    countryCode: c.code,
    orderDateYmd: r.orderDate ? formatLocalYmd(r.orderDate) : "—",
    usd: fmtMoney(r.totalUsd),
    ils: fmtMoney(r.totalIlsWithVat),
    paymentLabel: pm ? PAYMENT_METHOD_LABELS[pm] ?? pm : "אין תשלום",
    statusId,
    statusLabel: labels[statusId] ?? statusId,
    tone: orderStatusTone(statusId),
  };
}

export async function listOrdersSourceTable(
  query: OrdersSourceListQuery = {},
): Promise<OrdersSourceListResult> {
  return ordersPerfRun("orders.load", async () => {
    const limit = Math.min(50, Math.max(1, Math.floor(query.limit || 25)));
    const page = Math.max(1, Math.floor(query.page || 1));
    const skip = (page - 1) * limit;
    const where = buildOrdersSourceWhere(query.filters ?? {});

    const [statusOptions, labelMap, raw] = await Promise.all([
      getOrderStatusOptionsCached(),
      getOrderStatusLabelMap(),
      (async () => {
        ordersPerfStart("orders.query");
        try {
          return await prisma.order.findMany({
            where,
            orderBy: orderByFromQuery(query),
            skip,
            take: limit + 1,
            select: orderListSelect,
          });
        } finally {
          ordersPerfEnd("orders.query");
        }
      })(),
    ]);

    ordersPerfStart("orders.pagination");
    const hasMore = raw.length > limit;
    const slice = hasMore ? raw.slice(0, limit) : raw;
    ordersPerfEnd("orders.pagination");

    ordersPerfStart("orders.response");
    const rows = slice.map((r) => mapOrderRow(r, labelMap));
    ordersPerfEnd("orders.response");

    return { rows, page, limit, hasMore, statusOptions };
  });
}

export async function listOrdersSourceForExport(
  query: OrdersSourceListQuery = {},
  maxRows = 5000,
): Promise<OrdersSourceRow[]> {
  const where = buildOrdersSourceWhere(query.filters ?? {});
  const [labelMap, raw] = await Promise.all([
    getOrderStatusLabelMap(),
    prisma.order.findMany({
      where,
      orderBy: orderByFromQuery(query),
      take: maxRows,
      select: orderListSelect,
    }),
  ]);
  return raw.map((r) => mapOrderRow(r, labelMap));
}

async function loadOrdersSourceKpisUncached(
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrdersSourceKpis> {
  return ordersPerfRun("orders.kpis", async () => {
    const base = {
      deletedAt: null,
      ...orderWhereForCountryScope(resolveCountryScopeFromCode(workCountry)),
    } satisfies Prisma.OrderWhereInput;
    const weekCode = DEFAULT_WEEK_CODE;

    const [totalOrders, sumAgg, countryGroups, weekOrders] = await Promise.all([
      prisma.order.count({ where: base }),
      prisma.order.aggregate({ where: base, _sum: { totalUsd: true } }),
      prisma.order.groupBy({
        by: ["sourceCountry"],
        where: { ...base, sourceCountry: { not: null } },
      }),
      prisma.order.count({ where: { ...base, weekCode } }),
    ]);

    return {
      totalOrders,
      totalUsd: fmtMoney(sumAgg._sum.totalUsd),
      activeCountries: countryGroups.length,
      weekOrders,
      weekCode,
    };
  });
}

export async function getOrdersSourceKpisCached(
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrdersSourceKpis> {
  return unstable_cache(
    () => loadOrdersSourceKpisUncached(workCountry),
    ["orders-source-kpis-v2", workCountry, DEFAULT_WEEK_CODE],
    { revalidate: 120, tags: ["orders-source-kpis"] },
  )();
}

export async function getOrderSourcePreview(orderId: string): Promise<OrdersSourcePreview | null> {
  return ordersPerfRun("orders.preview", async () => {
    const id = orderId.trim();
    if (!id) return null;

    const [order, labels, latestPay] = await Promise.all([
      prisma.order.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          customerNameSnapshot: true,
          sourceCountry: true,
          orderDate: true,
          totalUsd: true,
          totalIlsWithVat: true,
          status: true,
          paymentMethod: true,
          notes: true,
        },
      }),
      getOrderStatusLabelMap(),
      prisma.payment.findFirst({
        where: { orderId: id, isPaid: true },
        orderBy: { paymentDate: "desc" },
        select: { paymentCode: true, paymentMethod: true },
      }),
    ]);

    if (!order) return null;
    const c = countryLabel(order.sourceCountry);
    const pm = latestPay?.paymentMethod ?? order.paymentMethod;

    return {
      id: order.id,
      orderNumber: order.orderNumber ?? "—",
      customerName: order.customerNameSnapshot ?? "—",
      country: c.label,
      orderDateYmd: order.orderDate ? formatLocalYmd(order.orderDate) : "—",
      usd: fmtMoney(order.totalUsd),
      ils: fmtMoney(order.totalIlsWithVat),
      statusLabel: labels[order.status] ?? order.status,
      paymentCode: latestPay?.paymentCode ?? "—",
      paymentMethod: pm ? PAYMENT_METHOD_LABELS[pm] ?? pm : "—",
      notes: (order.notes ?? "").trim() || "—",
    };
  });
}
