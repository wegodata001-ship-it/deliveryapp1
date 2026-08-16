import { cache } from "react";
import { unstable_cache } from "next/cache";
import "server-only";
import { OS } from "@/lib/order-status-slugs";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { formatIlsDisplay } from "@/lib/money-format";
import { perfError, perfTimeEnd, perfTimeStart, withPerfTimer } from "@/lib/perf-log";
import { DASHBOARD_HIGH_BALANCE_TAG, DASHBOARD_STATS_TAG } from "@/lib/kpi-cache-tags";
import { resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import type { CountryScope } from "@/lib/country-data-scope";

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
  scope: CountryScope,
): Promise<{
  ordersInRange: number;
  openOrdersInRange: number;
  daily: { ordersToday: number };
  alerts: { unpaidOrders: number };
}> {
  return withPerfTimer("dashboard.query.orders", async () => {
    const [row] = await prisma.$queryRaw<
      [
        {
          ordersInRange: bigint;
          openOrdersInRange: bigint;
          ordersToday: bigint;
          unpaidOrders: bigint;
        },
      ]
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE o."orderDate" >= ${fromStart} AND o."orderDate" <= ${toEnd}
        ) AS "ordersInRange",
        COUNT(*) FILTER (
          WHERE o."orderDate" >= ${fromStart} AND o."orderDate" <= ${toEnd}
            AND o.status = ${OS.OPEN}
        ) AS "openOrdersInRange",
        COUNT(*) FILTER (
          WHERE o."orderDate" >= ${todayStart} AND o."orderDate" <= ${todayEnd}
        ) AS "ordersToday",
        COUNT(*) FILTER (
          WHERE o.status NOT IN (${OS.COMPLETED}, ${OS.CANCELLED})
            AND NOT EXISTS (
              SELECT 1 FROM "Payment" p
              WHERE p."orderId" = o.id AND p."isPaid" = true
            )
        ) AS "unpaidOrders"
      FROM "Order" o
      WHERE o."isActive" = true
        AND o."countryCode" = ${scope.workCountry}::"WorkCountryCode"
        AND o."sourceCountry" = ${scope.sourceCountry}::"OrderSourceCountry"
    `;

    return {
      ordersInRange: Number(row?.ordersInRange ?? 0),
      openOrdersInRange: Number(row?.openOrdersInRange ?? 0),
      daily: { ordersToday: Number(row?.ordersToday ?? 0) },
      alerts: { unpaidOrders: Number(row?.unpaidOrders ?? 0) },
    };
  });
}

async function queryPaymentDashboardAggregates(
  fromStart: Date,
  toEnd: Date,
  todayStart: Date,
  todayEnd: Date,
  olderThan24h: Date,
  scope: CountryScope,
): Promise<{
  paymentsReceivedCount: number;
  pendingPaymentsCount: number;
  daily: { paymentsToday: number; totalIls: string };
  alerts: { pendingPaymentsOlderThan24h: number };
}> {
  return withPerfTimer("dashboard.query.payments", async () => {
    const [row] = await prisma.$queryRaw<
      [
        {
          paymentsReceivedCount: bigint;
          pendingPaymentsCount: bigint;
          paymentsToday: bigint;
          paymentsTodayTotal: unknown;
          pendingPaymentsOlderThan24h: bigint;
        },
      ]
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE p."isPaid" = true
            AND p."paymentDate" >= ${fromStart} AND p."paymentDate" <= ${toEnd}
        ) AS "paymentsReceivedCount",
        COUNT(*) FILTER (
          WHERE p."isPaid" = false
            AND p."paymentDate" >= ${fromStart} AND p."paymentDate" <= ${toEnd}
        ) AS "pendingPaymentsCount",
        COUNT(*) FILTER (
          WHERE p."isPaid" = true
            AND p."paymentDate" >= ${todayStart} AND p."paymentDate" <= ${todayEnd}
        ) AS "paymentsToday",
        COALESCE(SUM(
          COALESCE(p."totalIlsWithVat", p."amountIls", 0)::numeric)
          FILTER (
            WHERE p."isPaid" = true
              AND p."paymentDate" >= ${todayStart} AND p."paymentDate" <= ${todayEnd}
          ),
          0
        ) AS "paymentsTodayTotal",
        COUNT(*) FILTER (
          WHERE p."isPaid" = false AND p."createdAt" < ${olderThan24h}
        ) AS "pendingPaymentsOlderThan24h"
      FROM "Payment" p
      WHERE p."countryCode" = ${scope.workCountry}::"WorkCountryCode"
    `;

    return {
      paymentsReceivedCount: Number(row?.paymentsReceivedCount ?? 0),
      pendingPaymentsCount: Number(row?.pendingPaymentsCount ?? 0),
      daily: {
        paymentsToday: Number(row?.paymentsToday ?? 0),
        totalIls: moneyIls(row?.paymentsTodayTotal ?? 0),
      },
      alerts: { pendingPaymentsOlderThan24h: Number(row?.pendingPaymentsOlderThan24h ?? 0) },
    };
  });
}

async function queryUserDashboardAggregates(): Promise<{ registeredUsers: number; activeUsers: number }> {
  return withPerfTimer("dashboard.query.users", async () => {
    const [row] = await prisma.$queryRaw<[{ registeredUsers: bigint; activeUsers: bigint }]>`
      SELECT
        COUNT(*) AS "registeredUsers",
        COUNT(*) FILTER (WHERE u."isActive" = true) AS "activeUsers"
      FROM "User" u
    `;
    return {
      registeredUsers: Number(row?.registeredUsers ?? 0),
      activeUsers: Number(row?.activeUsers ?? 0),
    };
  });
}

/** שאילתה כבדה — Suspense נפרד; לפי מדינת עבודה בלבד */
export async function countHighBalanceCustomers(
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<number> {
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
            WHERE o."customerId" = c.id AND o."isActive" = true AND o."countryCode" = ${workCountry}::"WorkCountryCode"
          ), 0)
          -
          COALESCE((
            SELECT SUM(COALESCE(p."totalIlsWithVat", p."amountIls", 0)::numeric)
            FROM "Payment" p
            WHERE p."customerId" = c.id AND p."isPaid" = true AND p."countryCode" = ${workCountry}::"WorkCountryCode"
          ), 0)
        ) > ${HIGH_BALANCE_THRESHOLD_ILS}
      ) AS sub
    `;
    return Number(rows[0]?.count ?? 0);
  });
}

export const getDashboardHighBalanceCount = cache(
  (workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY): Promise<number> =>
    unstable_cache(
      async () => {
        try {
          return await countHighBalanceCustomers(workCountry);
        } catch (error) {
          perfError("dashboard.query.highBalance.failed", error);
          return 0;
        }
      },
      ["wego-dashboard-high-balance-v3", workCountry],
      { revalidate: DASHBOARD_CACHE_SECONDS, tags: [DASHBOARD_HIGH_BALANCE_TAG] },
    )(),
);

export async function loadDashboardStatsCore(
  range: DashboardStatsRange,
  showStaff: boolean,
  scope: CountryScope,
): Promise<Omit<DashboardStats, "alerts"> & { alerts: Omit<DashboardStats["alerts"], "highBalanceCustomers"> }> {
  const label = perfTimeStart("dashboard.total");
  try {
    const { fromStart, toEnd } = range;
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const todayEnd = endOfLocalDay(now);
    const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [orders, payments, users] = await Promise.all([
      queryOrderDashboardAggregates(fromStart, toEnd, todayStart, todayEnd, scope),
      queryPaymentDashboardAggregates(fromStart, toEnd, todayStart, todayEnd, olderThan24h, scope),
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
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<DashboardStats> {
  const core = await getDashboardStatsCore(range, me, workCountry);
  const highBalanceCustomers = await getDashboardHighBalanceCount(workCountry);
  return {
    ...core,
    alerts: { ...core.alerts, highBalanceCustomers },
  };
}

export const getDashboardStatsCore = cache(
  async (
    range: DashboardStatsRange,
    me: AppUser,
    workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
  ): Promise<
    Omit<DashboardStats, "alerts"> & { alerts: Omit<DashboardStats["alerts"], "highBalanceCustomers"> }
  > => {
    const fromIso = range.fromStart.toISOString();
    const toIso = range.toEnd.toISOString();
    const showStaff = isAdminUser(me) || me.permissionKeys.includes("manage_users");
    try {
      return await getDashboardStatsCached(fromIso, toIso, showStaff, workCountry);
    } catch (error) {
      perfError("dashboard.getDashboardStatsCore.failed", error);
      return { ...EMPTY_CORE };
    }
  },
);

const getDashboardStatsCached = unstable_cache(
  async (fromIso: string, toIso: string, showStaff: boolean, workCountry: WorkCountryCode) => {
    try {
      return await loadDashboardStatsCore(
        { fromStart: new Date(fromIso), toEnd: new Date(toIso) },
        showStaff,
        resolveCountryScopeFromCode(workCountry),
      );
    } catch (error) {
      perfError("dashboard.cache.load.failed", error);
      return { ...EMPTY_CORE };
    }
  },
  ["wego-dashboard-stats-v4"],
  { revalidate: DASHBOARD_CACHE_SECONDS, tags: [DASHBOARD_STATS_TAG] },
);
