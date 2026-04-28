"use server";

import { UserRole } from "@prisma/client";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export type ActivityStatus = "ACTIVE" | "INACTIVE";

export type ActivityUserRow = {
  id: string;
  userName: string;
  role: string;
  status: ActivityStatus;
  statusLabel: string;
};

export type ActivityPayload = {
  users: ActivityUserRow[];
  kpis: {
    active: number;
    inactive: number;
    total: number;
  };
};

function roleLabel(role: UserRole | string | null | undefined): string {
  return role === "ADMIN" ? "מנהל" : "עובד";
}

function activityStatus(lastAt: Date | null, now: Date): ActivityStatus {
  if (!lastAt) return "INACTIVE";
  const diffMin = (now.getTime() - lastAt.getTime()) / 60000;
  return diffMin < 5 ? "ACTIVE" : "INACTIVE";
}

function statusLabel(status: ActivityStatus): string {
  return status === "ACTIVE" ? "פעיל עכשיו" : "לא פעיל";
}

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_users"])) throw new Error("אין הרשאה");
}

export async function getActivityDashboardAction(): Promise<ActivityPayload> {
  await ensureAllowed();
  const now = new Date();

  const [users, latestByUser] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: true, lastLoginAt: true },
    }),
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { userId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const latestMap = new Map(latestByUser.map((r) => [r.userId, r._max.createdAt]));
  const rows = users.map((u): ActivityUserRow => {
    const latestAuditAt = latestMap.get(u.id) ?? null;
    const lastSeenAt =
      latestAuditAt && u.lastLoginAt ? (latestAuditAt > u.lastLoginAt ? latestAuditAt : u.lastLoginAt) : latestAuditAt ?? u.lastLoginAt;
    const status = activityStatus(lastSeenAt, now);
    return {
      id: u.id,
      userName: u.fullName,
      role: roleLabel(u.role),
      status,
      statusLabel: statusLabel(status),
    };
  });
  const active = rows.filter((u) => u.status === "ACTIVE").length;

  return {
    users: rows,
    kpis: { active, inactive: rows.length - active, total: rows.length },
  };
}
