import { OrderStatus } from "@prisma/client";
import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

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
  return `₪ ${v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function getDashboardStats(
  range: DashboardStatsRange,
  me: AppUser,
): Promise<DashboardStats> {
  const { fromStart, toEnd } = range;
  const orderDateFilter = { gte: fromStart, lte: toEnd };
  const paymentDateFilter = { gte: fromStart, lte: toEnd };
  const now = new Date();
  const todayFilter = { gte: startOfLocalDay(now), lte: endOfLocalDay(now) };
  const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const showStaff = isAdminUser(me) || me.permissionKeys.includes("manage_users");

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
    balanceRows,
  ] = await Promise.all([
    prisma.order.count({
      where: {
        deletedAt: null,
        orderDate: orderDateFilter,
      },
    }),
    prisma.order.count({
      where: {
        deletedAt: null,
        status: "OPEN",
        orderDate: orderDateFilter,
      },
    }),
    prisma.payment.count({
      where: {
        isPaid: true,
        paymentDate: paymentDateFilter,
      },
    }),
    prisma.payment.count({
      where: {
        isPaid: false,
        paymentDate: paymentDateFilter,
      },
    }),
    showStaff ? prisma.user.count() : Promise.resolve(0),
    showStaff ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(0),
    prisma.payment.count({ where: { isPaid: true, paymentDate: todayFilter } }),
    prisma.order.count({ where: { deletedAt: null, orderDate: todayFilter } }),
    prisma.payment.aggregate({
      where: { isPaid: true, paymentDate: todayFilter },
      _sum: { totalIlsWithVat: true, amountIls: true },
    }),
    prisma.payment.count({ where: { isPaid: false, createdAt: { lt: olderThan24h } } }),
    prisma.order.count({
      where: {
        deletedAt: null,
        status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        payments: { none: { isPaid: true } },
      },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null },
      take: 200,
      select: {
        orders: {
          where: { deletedAt: null },
          select: { totalIlsWithVat: true, totalIls: true },
        },
        payments: {
          where: { isPaid: true },
          select: { totalIlsWithVat: true, amountIls: true },
        },
      },
    }),
  ]);

  const highBalanceCustomers = balanceRows.filter((customer) => {
    const expected = customer.orders.reduce((sum, o) => sum + Number(o.totalIlsWithVat ?? o.totalIls ?? 0), 0);
    const received = customer.payments.reduce((sum, p) => sum + Number(p.totalIlsWithVat ?? p.amountIls ?? 0), 0);
    return expected - received > 10000;
  }).length;
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
}
