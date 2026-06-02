"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  ACTIVITY_PRESENCE_ACTION_TYPES,
  activityActionLabelHe,
} from "@/lib/activity-audit";
import {
  activityDashboardUserWhere,
  activityPresenceStatus,
  activityPresenceStatusLabel,
  activityRoleLabelHe,
  formatActivityClockHe,
  formatLastActivityHe,
  type ActivityPresenceStatus,
} from "@/lib/activity-dashboard";
import { prisma } from "@/lib/prisma";

export type ActivityStatus = ActivityPresenceStatus;

export type ActivityUserRow = {
  id: string;
  userName: string;
  role: string;
  status: ActivityStatus;
  statusLabel: string;
  lastActivityAt: string | null;
  lastActivityLabel: string;
};

export type ActivityLogRow = {
  id: string;
  timeLabel: string;
  userName: string;
  actionLabel: string;
  createdAt: string;
};

export type ActivityPayload = {
  users: ActivityUserRow[];
  logs: ActivityLogRow[];
  kpis: {
    total: number;
    activeNow: number;
    inactive: number;
  };
};

const LOG_LIMIT = 80;

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_users"])) throw new Error("אין הרשאה");
}

export async function getActivityDashboardAction(): Promise<ActivityPayload> {
  await ensureAllowed();
  const now = new Date();
  const userWhere = activityDashboardUserWhere();
  const presenceActions = [...ACTIVITY_PRESENCE_ACTION_TYPES];

  const [users, latestByUser, recentLogs] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: true, isActive: true },
    }),
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: {
        userId: { not: null },
        actionType: { in: presenceActions },
        user: userWhere,
      },
      _max: { createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: {
        userId: { not: null },
        actionType: { in: presenceActions },
        user: userWhere,
      },
      orderBy: { createdAt: "desc" },
      take: LOG_LIMIT,
      select: {
        id: true,
        createdAt: true,
        actionType: true,
        user: { select: { fullName: true } },
      },
    }),
  ]);

  const latestMap = new Map(
    latestByUser.map((r) => [r.userId, r._max.createdAt] as const),
  );

  const rows: ActivityUserRow[] = users.map((u) => {
    const lastAt = latestMap.get(u.id) ?? null;
    const status = activityPresenceStatus(lastAt, now);
    return {
      id: u.id,
      userName: u.fullName,
      role: activityRoleLabelHe(u.role),
      status,
      statusLabel: activityPresenceStatusLabel(status),
      lastActivityAt: lastAt?.toISOString() ?? null,
      lastActivityLabel: formatLastActivityHe(lastAt, now),
    };
  });

  const activeNow = rows.filter((u) => u.status === "ACTIVE").length;

  const logs: ActivityLogRow[] = recentLogs.map((log) => ({
    id: log.id,
    timeLabel: formatActivityClockHe(log.createdAt),
    userName: log.user?.fullName ?? "—",
    actionLabel: activityActionLabelHe(log.actionType),
    createdAt: log.createdAt.toISOString(),
  }));

  return {
    users: rows,
    logs,
    kpis: {
      total: rows.length,
      activeNow,
      inactive: rows.length - activeNow,
    },
  };
}
