import type { AppUser } from "@/lib/admin-auth";
import { isAdminUser } from "@/lib/admin-auth";
import {
  activityDetailLine,
  activityIconKind,
  activityTitleHe,
  DASHBOARD_BUSINESS_ACTION_TYPES,
} from "@/lib/business-activity";
import { prisma } from "@/lib/prisma";

export type DashboardStatsRange = { fromStart: Date; toEnd: Date };

/** Recent business-facing activity row for the home dashboard. */
export type DashboardActivityRow = {
  id: string;
  actionType: string;
  createdAt: Date;
  titleHe: string;
  detail: string;
  kind: ReturnType<typeof activityIconKind>;
};

export type DashboardStats = {
  ordersInRange: number;
  openOrdersInRange: number;
  paymentsReceivedCount: number;
  pendingPaymentsCount: number;
  registeredUsers: number;
  activeUsers: number;
  /** Whitelisted business audit events only (max 10). */
  recentActivities: DashboardActivityRow[];
};

export async function getDashboardStats(
  range: DashboardStatsRange,
  me: AppUser,
): Promise<DashboardStats> {
  const { fromStart, toEnd } = range;
  const orderDateFilter = { gte: fromStart, lte: toEnd };
  const paymentDateFilter = { gte: fromStart, lte: toEnd };
  const activityFilter = { gte: fromStart, lte: toEnd };

  const showStaff = isAdminUser(me) || me.permissionKeys.includes("manage_users");

  const [
    ordersInRange,
    openOrdersInRange,
    paymentsReceivedCount,
    pendingPaymentsCount,
    businessActivities,
    userCount,
    activeUsers,
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
    prisma.auditLog.findMany({
      where: {
        createdAt: activityFilter,
        actionType: { in: [...DASHBOARD_BUSINESS_ACTION_TYPES] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { fullName: true } } },
    }),
    showStaff ? prisma.user.count() : Promise.resolve(0),
    showStaff ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(0),
  ]);

  return {
    ordersInRange,
    openOrdersInRange,
    paymentsReceivedCount,
    pendingPaymentsCount,
    registeredUsers: userCount,
    activeUsers,
    recentActivities: businessActivities.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      createdAt: a.createdAt,
      titleHe: activityTitleHe(a.actionType),
      detail: activityDetailLine(a.actionType, a.metadata, a.user?.fullName ?? null),
      kind: activityIconKind(a.actionType),
    })),
  };
}
