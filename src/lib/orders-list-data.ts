import { OrderEditRequestStatus, type Prisma } from "@prisma/client";
import { isLegacyOrderStatusSlug, OS } from "@/lib/order-status-slugs";
import type { OrderListRow, OrdersStatusSummary } from "@/components/admin/OrdersListShell";
import type { OrdersCreatedByOption, OrdersPaymentLocationOption } from "@/components/admin/OrdersListToolbar";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { hasActiveEditUnlock } from "@/lib/order-edit-lock";
import { ORDERS_LIST_MAX_PAGE_SIZE, ORDERS_LIST_PAGE_SIZE } from "@/lib/orders-list-constants";
import { perfEnabled, withPerfTimer } from "@/lib/perf-log";
import { logDbEnvDiagnostics } from "@/lib/db-env-diagnostics";
import { prisma } from "@/lib/prisma";
import { formatLocalYmd, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";
import { buildOrdersListWhereFromSearchParams } from "@/app/admin/orders/orders-list-where";
import { formatMoneyAmount } from "@/lib/money-format";

function fmtUsd2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return formatMoneyAmount(v);
}

function fmtIls2(n: unknown): string | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return formatMoneyAmount(v);
}

function fmtDateTime(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function readPageParam(sp: Record<string, string | string[] | undefined>): number {
  const raw = sp.page;
  const s = typeof raw === "string" ? raw.trim() : "";
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export type OrdersListPageData = {
  orders: OrderListRow[];
  statusSummary: OrdersStatusSummary;
  createdByOptions: OrdersCreatedByOption[];
  paymentLocationOptions: OrdersPaymentLocationOption[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
};

const orderListSelect = {
  id: true,
  orderNumber: true,
  customerId: true,
  customerCodeSnapshot: true,
  customerNameSnapshot: true,
  orderDate: true,
  weekCode: true,
  status: true,
  sourceCountry: true,
  paymentMethod: true,
  paymentPointId: true,
  locationId: true,
  amountUsd: true,
  commissionUsd: true,
  totalUsd: true,
  debtWithdrawalUsd: true,
  totalIlsWithVat: true,
  totalIls: true,
  editUnlockedForUserId: true,
  editUnlockedUntil: true,
  paymentPoint: { select: { pointName: true } },
  createdById: true,
  createdBy: { select: { fullName: true, username: true } },
  customer: { select: { phone: true, phone2: true } },
} as const;

type OrderListDbRow = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;
type StatusGroupRow = { status: string; _count: { _all: number }; _sum: { totalUsd: unknown } };
type IntakeLocationRow = { id: string; name: string };
type PaymentSumRow = { orderId: string | null; _sum: { amountUsd: unknown } };
type EditRequestsPayload = {
  pendingRows: { orderId: string; requestedByUserId: string }[];
  recentRequests: { orderId: string; status: OrderEditRequestStatus; requestedByUserId: string }[];
};
type CacheEntry<T> = { expiresAt: number; value: T };

const ORDERS_LIST_CACHE_TTL_MS = 120_000;
const ORDERS_LIST_CACHE_MAX_ENTRIES = 120;

const ordersStore = new Map<string, CacheEntry<OrderListDbRow[]>>();
const ordersCountStore = new Map<string, CacheEntry<number>>();
const ordersStatsStore = new Map<string, CacheEntry<IntakeLocationRow[]>>();
const ordersKpiStore = new Map<string, CacheEntry<StatusGroupRow[]>>();
const ordersPaymentSumsStore = new Map<string, CacheEntry<PaymentSumRow[]>>();
const ordersEditRequestsStore = new Map<string, CacheEntry<EditRequestsPayload>>();

export function invalidateOrdersListDataCache(): void {
  ordersStore.clear();
  ordersCountStore.clear();
  ordersStatsStore.clear();
  ordersKpiStore.clear();
  ordersPaymentSumsStore.clear();
  ordersEditRequestsStore.clear();
}

function pruneCache<T>(store: Map<string, CacheEntry<T>>): void {
  if (store.size <= ORDERS_LIST_CACHE_MAX_ENTRIES) return;
  const first = store.keys().next().value;
  if (first) store.delete(first);
}

function getCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache<T>(store: Map<string, CacheEntry<T>>, key: string, value: T): void {
  pruneCache(store);
  store.set(key, { expiresAt: Date.now() + ORDERS_LIST_CACHE_TTL_MS, value });
}

function stableParamValue(value: string | string[] | undefined): string | string[] | null {
  if (Array.isArray(value)) return [...value].sort();
  return typeof value === "string" ? value : null;
}

function stableSearchParamsKey(sp: Record<string, string | string[] | undefined>): string {
  return JSON.stringify(
    Object.keys(sp)
      .sort()
      .map((key) => [key, stableParamValue(sp[key])] as const)
      .filter(([, value]) => value != null && !(Array.isArray(value) && value.length === 0)),
  );
}

function buildOrdersStatsScopeParams(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const key of ["ordersWeek", "ordersFrom", "ordersTo", "week", "from", "to", "country", "ordersCountry"]) {
    if (sp[key] != null) out[key] = sp[key];
  }
  return out;
}

function ordersScopeCacheKey(sp: Record<string, string | string[] | undefined>): string {
  const range = parseOrdersListDateFilterFromSearchParams(sp);
  return stableSearchParamsKey({
    ...buildOrdersStatsScopeParams(sp),
    __from: range.fromYmd,
    __to: range.toYmd,
  });
}

export type FetchOrdersListPageDataOptions = {
  bypassCache?: boolean;
  refreshStats?: boolean;
};

/**
 * מקור נתונים יחיד ל־SSR של `/admin/orders` (ללא fetch כפול בצד לקוח).
 */
export async function fetchOrdersListPageData(
  sp: Record<string, string | string[] | undefined>,
  me: AppUser,
  options: FetchOrdersListPageDataOptions = {},
): Promise<OrdersListPageData> {
  logDbEnvDiagnostics("server /admin/orders fetchOrdersListPageData");
  const perfT0 = Date.now();
  let ordersQueryMs = 0;
  let ordersCountMs = 0;
  let statsMs = 0;
  let kpiMs = 0;
  let summaryMs = 0;
  let renderMs = 0;
  let serializationMs = 0;
  let cacheHit = 0;
  let cacheMiss = 0;
  const cacheState: Record<string, "hit" | "miss" | "bypass"> = {};

  const perfTimed = async <T>(
    setter: (ms: number) => void,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (!perfEnabled()) return work();
    const t0 = Date.now();
    try {
      return await work();
    } finally {
      setter(Date.now() - t0);
    }
  };
  const cachedTimed = async <T>(
    label: string,
    store: Map<string, CacheEntry<T>>,
    key: string,
    setter: (ms: number) => void,
    work: () => Promise<T>,
    opts?: { bypass?: boolean },
  ): Promise<T> => {
    if (!opts?.bypass && !options.bypassCache) {
      const cached = getCache(store, key);
      if (cached !== undefined) {
        cacheHit += 1;
        cacheState[label] = "hit";
        return cached;
      }
    }
    cacheMiss += 1;
    cacheState[label] = options.bypassCache || opts?.bypass ? "bypass" : "miss";
    const value = await perfTimed(setter, work);
    setCache(store, key, value);
    return value;
  };

  const where = buildOrdersListWhereFromSearchParams(sp);
  const statsScopeParams = buildOrdersStatsScopeParams(sp);
  const statsWhere = buildOrdersListWhereFromSearchParams(statsScopeParams);
  const fullCacheKey = stableSearchParamsKey(sp);
  const scopeCacheKey = ordersScopeCacheKey(sp);
  const page = readPageParam(sp);
  const pageSize = ORDERS_LIST_PAGE_SIZE;
  const ordersPageCacheKey = `${fullCacheKey}|page=${page}|pageSize=${pageSize}|user=${me.id}`;
  const countCacheKey = `${fullCacheKey}|count`;

  const [statusGroups, intakeLocationRows, totalCount] = await withPerfTimer(
    "orders.page.fetchOrders",
    async () => {
      const statusP = cachedTimed("ordersKpiStore", ordersKpiStore, scopeCacheKey, (ms) => (kpiMs += ms), async () =>
        (await (prisma.order.groupBy as unknown as (args: {
          by: ["status"];
          where: Prisma.OrderWhereInput;
          _count: { _all: true };
          _sum: { totalUsd: true };
        }) => Promise<StatusGroupRow[]>)({
          by: ["status"],
          where: statsWhere,
          _count: { _all: true },
          _sum: { totalUsd: true },
        })) as StatusGroupRow[],
        { bypass: options.refreshStats },
      );
      const locationsP = cachedTimed("ordersStatsStore", ordersStatsStore, "intakeLocations:v1", (ms) => (statsMs += ms), () =>
        prisma.intakeLocation.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
        { bypass: options.refreshStats },
      );
      const countP = cachedTimed("ordersCountStore", ordersCountStore, countCacheKey, (ms) => (ordersCountMs += ms), () =>
        prisma.order.count({ where }),
      );
      return Promise.all([statusP, locationsP, countP]);
    },
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * pageSize;

  const rows = await cachedTimed("ordersStore", ordersStore, ordersPageCacheKey, (ms) => (ordersQueryMs += ms), () =>
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      skip,
      take: Math.min(pageSize, ORDERS_LIST_MAX_PAGE_SIZE),
      select: orderListSelect,
    }),
  );

  const intakeById = new Map(intakeLocationRows.map((l) => [l.id, l.name.trim()]));

  const sensitiveIds = rows
    .filter((r) => r.status === OS.COMPLETED || r.status === OS.CANCELLED)
    .map((r) => r.id);

  let pendingEditOrderIds = new Set<string>();
  const pendingRequestedByUserId = new Map<string, string>();
  const latestEditRequestByOrder = new Map<
    string,
    { status: OrderEditRequestStatus; requestedByUserId: string }
  >();

  if (sensitiveIds.length > 0) {
    const editTake = Math.min(sensitiveIds.length * 4, 400);
    const editRequests = await cachedTimed(
      "ordersEditRequestsStore",
      ordersEditRequestsStore,
      `editRequests:${sensitiveIds.slice().sort().join(",")}:take=${editTake}`,
      (ms) => (statsMs += ms),
      async () => {
        const [pendingRows, recentRequests] = await Promise.all([
          prisma.orderEditRequest.findMany({
            where: { orderId: { in: sensitiveIds }, status: OrderEditRequestStatus.PENDING },
            select: { orderId: true, requestedByUserId: true },
          }),
          prisma.orderEditRequest.findMany({
            where: { orderId: { in: sensitiveIds } },
            orderBy: { createdAt: "desc" },
            select: { orderId: true, status: true, requestedByUserId: true },
            take: editTake,
          }),
        ]);
        return { pendingRows, recentRequests };
      },
    );
    const { pendingRows, recentRequests } = editRequests;
    pendingEditOrderIds = new Set(pendingRows.map((p) => p.orderId));
    for (const p of pendingRows) {
      pendingRequestedByUserId.set(p.orderId, p.requestedByUserId);
    }
    for (const req of recentRequests) {
      if (!latestEditRequestByOrder.has(req.orderId)) {
        latestEditRequestByOrder.set(req.orderId, {
          status: req.status,
          requestedByUserId: req.requestedByUserId,
        });
      }
    }
  }

  const statusSummaryAcc = {
    open: { count: 0, totalUsd: 0 },
    inProgress: { count: 0, totalUsd: 0 },
    completed: { count: 0, totalUsd: 0 },
    cancelled: { count: 0, totalUsd: 0 },
    debtWithdrawal: { count: 0, totalUsd: 0 },
  };
  for (const g of statusGroups) {
    const count = g._count?._all ?? 0;
    const totalUsd = Number(g._sum?.totalUsd ?? 0);
    switch (g.status) {
      case OS.OPEN:
        statusSummaryAcc.open.count += count;
        statusSummaryAcc.open.totalUsd += totalUsd;
        break;
      case OS.COMPLETED:
        statusSummaryAcc.completed.count += count;
        statusSummaryAcc.completed.totalUsd += totalUsd;
        break;
      case OS.CANCELLED:
        statusSummaryAcc.cancelled.count += count;
        statusSummaryAcc.cancelled.totalUsd += totalUsd;
        break;
      case OS.DEBT_WITHDRAWAL:
        statusSummaryAcc.debtWithdrawal.count += count;
        statusSummaryAcc.debtWithdrawal.totalUsd += totalUsd;
        break;
      case OS.WAITING_FOR_EXECUTION:
      case OS.WITHDRAWAL_FROM_SUPPLIER:
      case OS.SENT:
      case OS.WAITING_FOR_CHINA_EXECUTION:
        statusSummaryAcc.inProgress.count += count;
        statusSummaryAcc.inProgress.totalUsd += totalUsd;
        break;
      default:
        if (!isLegacyOrderStatusSlug(g.status)) {
          statusSummaryAcc.inProgress.count += count;
          statusSummaryAcc.inProgress.totalUsd += totalUsd;
        }
        break;
    }
  }
  const fmtUsdCompact = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let allTotalUsd = 0;
  for (const g of statusGroups) {
    allTotalUsd += Number(g._sum?.totalUsd ?? 0);
  }
  const statusSummary: OrdersStatusSummary = {
    all: {
      count: totalCount.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(allTotalUsd),
    },
    open: {
      count: statusSummaryAcc.open.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.open.totalUsd),
    },
    inProgress: {
      count: statusSummaryAcc.inProgress.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.inProgress.totalUsd),
    },
    completed: {
      count: statusSummaryAcc.completed.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.completed.totalUsd),
    },
    cancelled: {
      count: statusSummaryAcc.cancelled.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.cancelled.totalUsd),
    },
    debtWithdrawal: {
      count: statusSummaryAcc.debtWithdrawal.count.toLocaleString("he-IL"),
      totalUsd: fmtUsdCompact(statusSummaryAcc.debtWithdrawal.totalUsd),
    },
  };

  const ids = rows.map((r) => r.id);
  const paySums =
    ids.length > 0
      ? await cachedTimed("ordersPaymentSumsStore", ordersPaymentSumsStore, `paySums:${ids.slice().sort().join(",")}`, (ms) => (statsMs += ms), async () =>
          (await (prisma.payment.groupBy as unknown as (args: {
            by: ["orderId"];
            where: Prisma.PaymentWhereInput;
            _sum: { amountUsd: true };
          }) => Promise<PaymentSumRow[]>)({
            by: ["orderId"],
            where: { orderId: { in: ids } },
            _sum: { amountUsd: true },
          })) as PaymentSumRow[],
        )
      : [];
  const paidByOrder = new Map<string, number>();
  for (const p of paySums) {
    if (p.orderId) {
      paidByOrder.set(p.orderId, Number(p._sum.amountUsd ?? 0));
    }
  }

  const canEditOrders = userHasAnyPermission(me, ["edit_orders"]);

  const orders: OrderListRow[] = await perfTimed((ms) => (summaryMs += ms), async () =>
    rows.map((r) => {
      const total = r.totalUsd != null ? Number(r.totalUsd) : 0;
      const isDebtWithdrawal = r.status === OS.DEBT_WITHDRAWAL;
      const rawPaid = paidByOrder.get(r.id) ?? 0;
      const paid = isDebtWithdrawal ? 0 : rawPaid;
      const balanceUsd = isDebtWithdrawal ? 0 : total - paid;
      let paymentStatus: OrderListRow["paymentStatus"] = "unpaid";
      if (isDebtWithdrawal) {
        paymentStatus = "paid";
      } else if (total > 0.01) {
        if (paid >= total - 0.02) paymentStatus = "paid";
        else if (paid > 0.01) paymentStatus = "partial";
      } else if (paid > 0.01) {
        paymentStatus = "partial";
      }

      let editBadge: OrderListRow["editBadge"] = null;
      let pendingEditOwnedByMe = false;
      const sensitiveForEditLock = r.status === OS.COMPLETED || r.status === OS.CANCELLED;
      if (sensitiveForEditLock) {
        if (pendingEditOrderIds.has(r.id)) {
          editBadge = "pending";
          pendingEditOwnedByMe = pendingRequestedByUserId.get(r.id) === me.id;
        } else if (
          hasActiveEditUnlock({
            editUnlockedForUserId: r.editUnlockedForUserId,
            editUnlockedUntil: r.editUnlockedUntil,
            viewerUserId: me.id,
          })
        ) {
          editBadge = "unlock";
        } else {
          const latest = latestEditRequestByOrder.get(r.id);
          if (
            latest?.status === OrderEditRequestStatus.REJECTED &&
            latest.requestedByUserId === me.id
          ) {
            editBadge = "rejected";
          } else if (!isAdminUser(me)) {
            editBadge = "locked";
          }
        }
      }

      const quickStatusLocked =
        canEditOrders &&
        !isAdminUser(me) &&
        sensitiveForEditLock &&
        !hasActiveEditUnlock({
          editUnlockedForUserId: r.editUnlockedForUserId,
          editUnlockedUntil: r.editUnlockedUntil,
          viewerUserId: me.id,
        });

      const paymentLocationId = r.paymentPointId ?? r.locationId ?? null;
      const paymentLocationName =
        r.paymentPoint?.pointName?.trim() ||
        (r.locationId ? intakeById.get(r.locationId) ?? null : null) ||
        null;

      return {
        id: r.id,
        orderNumber: r.orderNumber,
        customerId: r.customerId,
        customerCode: r.customerCodeSnapshot?.trim() || null,
        customerName: r.customerNameSnapshot?.trim() || null,
        customerPhone: r.customer?.phone ?? r.customer?.phone2 ?? null,
        orderDateYmd: r.orderDate ? formatLocalYmd(new Date(r.orderDate)) : null,
        orderDateTime: fmtDateTime(r.orderDate ? new Date(r.orderDate) : null),
        weekCode: r.weekCode,
        status: (r.status as unknown as string | null | undefined)?.trim() || OS.OPEN,
        sourceCountry: r.sourceCountry,
        paymentType: r.paymentMethod,
        paymentLocationId,
        paymentLocationName,
        createdById: r.createdById,
        createdByName: r.createdBy?.fullName || r.createdBy?.username || null,
        dealAmountUsd: fmtUsd2(r.amountUsd),
        commissionAmountUsd: fmtUsd2(r.commissionUsd),
        totalAmountUsd: fmtUsd2(r.totalUsd),
        balanceUsd: fmtUsd2(balanceUsd),
        totalAmountIls: fmtIls2(r.totalIlsWithVat ?? r.totalIls),
        paymentStatus,
        editBadge,
        pendingEditOwnedByMe: editBadge === "pending" ? pendingEditOwnedByMe : undefined,
        quickStatusLocked,
      };
    }),
  );

  if (perfEnabled()) {
    const totalMs = Date.now() - perfT0;
    console.table({
      cacheHit,
      cacheMiss,
      ordersQueryMs,
      ordersCountMs,
      statsMs,
      kpiMs,
      summaryMs,
      renderMs,
      serializationMs,
      totalMs,
    });
    console.log("[orders-list-cache]", {
      cacheHit,
      cacheMiss,
      cacheState,
      scopeCacheKey,
    });
  }

  return {
    orders,
    statusSummary,
    createdByOptions: [],
    paymentLocationOptions: intakeLocationRows.map((l) => ({ id: l.id, label: l.name })),
    pagination: {
      page: safePage,
      pageSize,
      totalCount,
      totalPages,
    },
  };
}
