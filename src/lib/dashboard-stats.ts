import { unstable_cache } from "next/cache";
import { cache } from "react";
import { OS } from "@/lib/order-status-slugs";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { formatIlsDisplay } from "@/lib/money-format";
import { withPerfTimer } from "@/lib/perf-log";

export type DashboardStatsRange = { fromStart: Date; toEnd: Date };

/** Kept for the legacy activity feed component. The home dashboard no longer renders it. */
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

const HIGH_BALANCE_THRESHOLD_ILS = 10_000;

async function countHighBalanceCustomers(): Promise<number> {
  return withPerfTimer("dashboard.highBalanceCustomers", async () => {
    const rows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT c.id
        FROM "Customer" c
        WHERE c."deletedAt" IS NULL
        GROUP BY c.id
        HAVING (
          COALESCE((
            SELECT SUM(COALESCE(o."totalIlsWithVat", o."totalIls", 0)::numeric)
            FROM "Order" o
            WHERE o."customerId" = c.id AND o."deletedAt" IS NULL
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

export const getDashboardStats = cache(async function getDashboardStats(
  range: DashboardStatsRange,
  me: AppUser,
): Promise<DashboardStats> {
  const fromIso = range.fromStart.toISOString();
  const toIso = range.toEnd.toISOString();
  const showStaff = isAdminUser(me) || me.permissionKeys.includes("manage_users");

  return getDashboardStatsCached(fromIso, toIso, showStaff);
});

const getDashboardStatsCached = unstable_cache(
  async (fromIso: string, toIso: string, showStaff: boolean): Promise<DashboardStats> => {
    return loadDashboardStats(
      { fromStart: new Date(fromIso), toEnd: new Date(toIso) },
      showStaff,
    );
  },
  ["wego-dashboard-stats"],
  { revalidate: 45 },
);

async function loadDashboardStats(
  range: DashboardStatsRange,
  showStaff: boolean,
): Promise<DashboardStats> {
  return withPerfTimer("dashboard.getDashboardStats", async () => {
    const { fromStart, toEnd } = range;
    const orderDateFilter = { gte: fromStart, lte: toEnd };
    const paymentDateFilter = { gte: fromStart, lte: toEnd };
    const now = new Date();
    const todayFilter = { gte: startOfLocalDay(now), lte: endOfLocalDay(now) };
    const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      ordersInRange,
      openOrdersInRange,
      paymentsReceivedCount,
      pendingPaymentsCount,
      userCount,
      activeUsers,
      paymentsToday,
      ordersToday,
      paymentsTodaySum,
      pendingPaymentsOlderThan24h,
      unpaidOrders,
      highBalanceCustomers,
    ] = await withPerfTimer("dashboard.parallelQueries", () =>
      Promise.all([
        withPerfTimer("dashboard.ordersInRange", () =>
          prisma.order.count({
            where: { deletedAt: null, orderDate: orderDateFilter },
          }),
        ),
        withPerfTimer("dashboard.openOrdersInRange", () =>
          prisma.order.count({
            where: { deletedAt: null, status: "OPEN", orderDate: orderDateFilter },
          }),
        ),
        withPerfTimer("dashboard.paymentsReceived", () =>
          prisma.payment.count({
            where: { isPaid: true, paymentDate: paymentDateFilter },
          }),
        ),
        withPerfTimer("dashboard.pendingPayments", () =>
          prisma.payment.count({
            where: { isPaid: false, paymentDate: paymentDateFilter },
          }),
        ),
        showStaff
          ? withPerfTimer("dashboard.userCount", () => prisma.user.count())
          : Promise.resolve(0),
        showStaff
          ? withPerfTimer("dashboard.activeUsers", () => prisma.user.count({ where: { isActive: true } }))
          : Promise.resolve(0),
        withPerfTimer("dashboard.paymentsToday", () =>
          prisma.payment.count({ where: { isPaid: true, paymentDate: todayFilter } }),
        ),
        withPerfTimer("dashboard.ordersToday", () =>
          prisma.order.count({ where: { deletedAt: null, orderDate: todayFilter } }),
        ),
        withPerfTimer("dashboard.paymentsTodaySum", () =>
          prisma.payment.aggregate({
            where: { isPaid: true, paymentDate: todayFilter },
            _sum: { totalIlsWithVat: true, amountIls: true },
          }),
        ),
        withPerfTimer("dashboard.pendingPayments24h", () =>
          prisma.payment.count({ where: { isPaid: false, createdAt: { lt: olderThan24h } } }),
        ),
        withPerfTimer("dashboard.unpaidOrders", () =>
          prisma.order.count({
            where: {
              deletedAt: null,
              status: { notIn: [OS.COMPLETED, OS.CANCELLED] },
              payments: { none: { isPaid: true } },
            },
          }),
        ),
        countHighBalanceCustomers(),
      ]),
    );

    const todayTotal = paymentsTodaySum._sum.totalIlsWithVat ?? paymentsTodaySum._sum.amountIls ?? 0;

    return {
      ordersInRange,
      openOrdersInRange,
      paymentsReceivedCount,
      pendingPaymentsCount,
      registeredUsers: userCount,
      activeUsers,
      daily: {
        paymentsToday,
        ordersToday,
        totalIls: moneyIls(todayTotal),
      },
      alerts: {
        pendingPaymentsOlderThan24h,
        unpaidOrders,
        highBalanceCustomers,
      },
    };
  });
}
