import { unstable_cache } from "next/cache";
import { cache } from "react";
import { OS } from "@/lib/order-status-slugs";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { formatIlsDisplay } from "@/lib/money-format";
import { perfError, perfTimeEnd, perfTimeStart, withPerfTimer } from "@/lib/perf-log";

export type DashboardStatsRange = { fromStart: Date; toEnd: Date };

/** Legacy activity feed type */
export type DashboardActivityRow = {
  id: string;
  actionType: string;
  createdAt: Date;
  titleHe: string;
  detail: string;
  kind: "order" | "payment" | "customer";
};

export type DashboardStats = {
  ordersInRange: number;
  openOrdersInRange: number;
  paymentsReceivedCount: number;
  pendingPaymentsCount: number;
  registeredUsers: number;
  activeUsers: number;
  daily: {
    paymentsToday: number;
    ordersToday: number;
    totalIls: string;
  };
  alerts: {
    pendingPaymentsOlderThan24h: number;
    unpaidOrders: number;
    highBalanceCustomers: number;
  };
};

const HIGH_BALANCE_THRESHOLD_ILS = 10_000;
const DASHBOARD_CACHE_SECONDS = 60;

/** Order active filter — ללא deletedAt (לא קיים ב-DB בפועל) */
const orderActiveWhere = { isActive: true } as const;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function moneyIls(n: unknown): string {
  const v = Number(String(n ?? "0"));
  return Number.isFinite(v) ? formatIlsDisplay(v) : formatIlsDisplay(0);
}

const EMPTY_CORE: Omit<DashboardStats, "alerts"> & {
  alerts: Omit<DashboardStats["alerts"], "highBalanceCustomers">;
} = {
  ordersInRange: 0,
  openOrdersInRange: 0,
  paymentsReceivedCount: 0,
  pendingPaymentsCount: 0,
  registeredUsers: 0,
  activeUsers: 0,
  daily: { paymentsToday: 0, ordersToday: 0, totalIls: moneyIls(0) },
  alerts: { pendingPaymentsOlderThan24h: 0, unpaidOrders: 0 },
};

async function queryOrderDashboardAggregates(
  fromStart: Date,
  toEnd: Date,
  todayStart: Date,
  todayEnd: Date,
): Promise<{
  ordersInRange: number;
  openOrdersInRange: number;
  daily: { ordersToday: number };
  alerts: { unpaidOrders: number };
}> {
  return withPerfTimer("dashboard.query.orders", async () => {
    const orderDateFilter = { gte: fromStart, lte: toEnd };
    const todayFilter = { gte: todayStart, lte: todayEnd };

    const [ordersInRange, openOrdersInRange, ordersToday, unpaidOrders] = await Promise.all([
      prisma.order.count({
        where: { ...orderActiveWhere, orderDate: orderDateFilter },
      }),
      prisma.order.count({
        where: { ...orderActiveWhere, status: OS.OPEN, orderDate: orderDateFilter },
      }),
      prisma.order.count({
        where: { ...orderActiveWhere, orderDate: todayFilter },
      }),
      prisma.order.count({
        where: {
          ...orderActiveWhere,
          status: { notIn: [OS.COMPLETED, OS.CANCELLED] },
          payments: { none: { isPaid: true } },
        },
      }),
    ]);

    return {
      ordersInRange,
      openOrdersInRange,
      daily: { ordersToday },
      alerts: { unpaidOrders },
    };
  });
}

async function queryPaymentDashboardAggregates(
  fromStart: Date,
  toEnd: Date,
  todayStart: Date,
  todayEnd: Date,
  olderThan24h: Date,
): Promise<{
  paymentsReceivedCount: number;
  pendingPaymentsCount: number;
  daily: { paymentsToday: number; totalIls: string };
  alerts: { pendingPaymentsOlderThan24h: number };
}> {
  return withPerfTimer("dashboard.query.payments", async () => {
    const paymentDateFilter = { gte: fromStart, lte: toEnd };
    const todayFilter = { gte: todayStart, lte: todayEnd };

    const [paymentsReceivedCount, pendingPaymentsCount, paymentsToday, paymentsTodaySum, pendingPaymentsOlderThan24h] =
      await Promise.all([
        prisma.payment.count({
          where: { isPaid: true, paymentDate: paymentDateFilter },
        }),
        prisma.payment.count({
          where: { isPaid: false, paymentDate: paymentDateFilter },
        }),
        prisma.payment.count({
          where: { isPaid: true, paymentDate: todayFilter },
        }),
        prisma.payment.aggregate({
          where: { isPaid: true, paymentDate: todayFilter },
          _sum: { totalIlsWithVat: true, amountIls: true },
        }),
        prisma.payment.count({
          where: { isPaid: false, createdAt: { lt: olderThan24h } },
        }),
      ]);

    const todayTotal = paymentsTodaySum._sum.totalIlsWithVat ?? paymentsTodaySum._sum.amountIls ?? 0;

    return {
      paymentsReceivedCount,
      pendingPaymentsCount,
      daily: {
        paymentsToday,
        totalIls: moneyIls(todayTotal),
      },
      alerts: { pendingPaymentsOlderThan24h },
    };
  });
}

async function queryUserDashboardAggregates(): Promise<{ registeredUsers: number; activeUsers: number }> {
  return withPerfTimer("dashboard.query.users", async () => {
    const [registeredUsers, activeUsers] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
    ]);
    return { registeredUsers, activeUsers };
  });
}

/** שאילתה כבדה — Suspense נפרד; ללא deletedAt על Order */
export async function countHighBalanceCustomers(): Promise<number> {
  return withPerfTimer("dashboard.query.highBalance", async () => {
    const rows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT c.id
        FROM "Customer" c
        WHERE c."isActive" = true
        GROUP BY c.id
        HAVING (
          COALESCE((
            SELECT SUM(COALESCE(o."totalIlsWithVat", o."totalIls", 0)::numeric)
            FROM "Order" o
            WHERE o."customerId" = c.id AND o."isActive" = true
          ), 0)
          -
          COALESCE((
            SELECT SUM(COALESCE(p."totalIlsWithVat", p."amountIls", 0)::numeric)
            FROM "Payment" p
            WHERE p."customerId" = c.id AND p."isPaid" = true
          ), 0)
        ) > ${HIGH_BALANCE_THRESHOLD_ILS}
      ) AS sub
    `;
    return Number(rows[0]?.count ?? 0);
  });
}

const getHighBalanceCached = unstable_cache(
  async () => {
    try {
      return await countHighBalanceCustomers();
    } catch (error) {
      perfError("dashboard.query.highBalance.failed", error);
      return 0;
    }
  },
  ["wego-dashboard-high-balance-v2"],
  { revalidate: DASHBOARD_CACHE_SECONDS },
);

export const getDashboardHighBalanceCount = cache(async (): Promise<number> => {
  return getHighBalanceCached();
});

async function loadDashboardStatsCore(
  range: DashboardStatsRange,
  showStaff: boolean,
): Promise<Omit<DashboardStats, "alerts"> & { alerts: Omit<DashboardStats["alerts"], "highBalanceCustomers"> }> {
  const label = perfTimeStart("dashboard.total");
  try {
    const { fromStart, toEnd } = range;
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const todayEnd = endOfLocalDay(now);
    const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [orders, payments, users] = await Promise.all([
      queryOrderDashboardAggregates(fromStart, toEnd, todayStart, todayEnd),
      queryPaymentDashboardAggregates(fromStart, toEnd, todayStart, todayEnd, olderThan24h),
      showStaff ? queryUserDashboardAggregates() : Promise.resolve({ registeredUsers: 0, activeUsers: 0 }),
    ]);

    return {
      ordersInRange: orders.ordersInRange,
      openOrdersInRange: orders.openOrdersInRange,
      paymentsReceivedCount: payments.paymentsReceivedCount,
      pendingPaymentsCount: payments.pendingPaymentsCount,
      registeredUsers: users.registeredUsers,
      activeUsers: users.activeUsers,
      daily: {
        paymentsToday: payments.daily.paymentsToday,
        ordersToday: orders.daily.ordersToday,
        totalIls: payments.daily.totalIls,
      },
      alerts: {
        pendingPaymentsOlderThan24h: payments.alerts.pendingPaymentsOlderThan24h,
        unpaidOrders: orders.alerts.unpaidOrders,
      },
    };
  } finally {
    perfTimeEnd(label);
  }
}

export async function getDashboardStats(
  range: DashboardStatsRange,
  me: AppUser,
): Promise<DashboardStats> {
  const core = await getDashboardStatsCore(range, me);
  const highBalanceCustomers = await getDashboardHighBalanceCount();
  return {
    ...core,
    alerts: { ...core.alerts, highBalanceCustomers },
  };
}

export async function getDashboardStatsCore(
  range: DashboardStatsRange,
  me: AppUser,
): Promise<
  Omit<DashboardStats, "alerts"> & { alerts: Omit<DashboardStats["alerts"], "highBalanceCustomers"> }
> {
  const fromIso = range.fromStart.toISOString();
  const toIso = range.toEnd.toISOString();
  const showStaff = isAdminUser(me) || me.permissionKeys.includes("manage_users");
  try {
    return await getDashboardStatsCached(fromIso, toIso, showStaff);
  } catch (error) {
    perfError("dashboard.getDashboardStatsCore.failed", error);
    return { ...EMPTY_CORE };
  }
}

const getDashboardStatsCached = unstable_cache(
  async (fromIso: string, toIso: string, showStaff: boolean) => {
    try {
      return await loadDashboardStatsCore(
        { fromStart: new Date(fromIso), toEnd: new Date(toIso) },
        showStaff,
      );
    } catch (error) {
      perfError("dashboard.cache.load.failed", error);
      return { ...EMPTY_CORE };
    }
  },
  ["wego-dashboard-stats-v3"],
  { revalidate: DASHBOARD_CACHE_SECONDS },
);
