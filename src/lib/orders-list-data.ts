import { OrderEditRequestStatus } from "@prisma/client";
import { isLegacyOrderStatusSlug, OS } from "@/lib/order-status-slugs";
import type { OrderListRow, OrdersStatusSummary } from "@/components/admin/OrdersListShell";
import type { OrdersCreatedByOption, OrdersPaymentLocationOption } from "@/components/admin/OrdersListToolbar";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { hasActiveEditUnlock } from "@/lib/order-edit-lock";
import { ORDERS_LIST_MAX_PAGE_SIZE, ORDERS_LIST_PAGE_SIZE } from "@/lib/orders-list-constants";
import { perfEnabled, withPerfTimer } from "@/lib/perf-log";
import { prisma } from "@/lib/prisma";
import { formatLocalYmd } from "@/lib/work-week";
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

/**
 * מקור נתונים יחיד ל־SSR של `/admin/orders` (ללא fetch כפול בצד לקוח).
 */
export async function fetchOrdersListPageData(
  sp: Record<string, string | string[] | undefined>,
  me: AppUser,
): Promise<OrdersListPageData> {
  const perfT0 = Date.now();
  let ordersQueryMs = 0;
  let ordersCountMs = 0;
  let statsMs = 0;
  let kpiMs = 0;
  let summaryMs = 0;
  let renderMs = 0;
  let serializationMs = 0;

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

  const where = buildOrdersListWhereFromSearchParams(sp);
  const page = readPageParam(sp);
  const pageSize = ORDERS_LIST_PAGE_SIZE;

  const [statusGroups, intakeLocationRows, totalCount] = await withPerfTimer(
    "orders.page.fetchOrders",
    async () => {
      const statusP = perfTimed((ms) => (kpiMs += ms), () =>
        prisma.order.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
          _sum: { totalUsd: true },
        }),
      );
      const locationsP = perfTimed((ms) => (statsMs += ms), () =>
        prisma.intakeLocation.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        }),
      );
      const countP = perfTimed((ms) => (ordersCountMs += ms), () =>
        prisma.order.count({ where }),
      );
      return Promise.all([statusP, locationsP, countP]);
    },
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * pageSize;

  const rows = await perfTimed((ms) => (ordersQueryMs += ms), () =>
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
    const [pendingRows, recentRequests] = await perfTimed((ms) => (statsMs += ms), () =>
      Promise.all([
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
      ]),
    );
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
  const statusSummary: OrdersStatusSummary = {
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
      ? await perfTimed((ms) => (statsMs += ms), () =>
          prisma.payment.groupBy({
            by: ["orderId"],
            where: { orderId: { in: ids } },
            _sum: { amountUsd: true },
          }),
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
    const rawPaid = paidByOrder.get(r.id) ?? 0;
    const debtWithdrawal = r.debtWithdrawalUsd != null ? Number(r.debtWithdrawalUsd) : 0;
    const paid = rawPaid + debtWithdrawal;
      const balanceUsd = total - paid;
      let paymentStatus: OrderListRow["paymentStatus"] = "unpaid";
      if (total > 0.01) {
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
      ordersQueryMs,
      ordersCountMs,
      statsMs,
      kpiMs,
      summaryMs,
      renderMs,
      serializationMs,
      totalMs,
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
