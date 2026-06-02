import type { Prisma, UserRole } from "@prisma/client";

/** Minutes without activity before a user is considered inactive on the dashboard. */
export const ACTIVITY_ACTIVE_WINDOW_MINUTES = 15;

const DEMO_USERNAMES = new Set(["employee1", "employee2", "qaadmin", "qa_admin"]);
const DEMO_FULL_NAMES = new Set(["Employee 1", "Employee 2", "QA Admin", "System Admin"]);

export type ActivityPresenceStatus = "ACTIVE" | "INACTIVE";

export function isDemoActivityUser(user: {
  username?: string | null;
  fullName: string;
  email?: string | null;
}): boolean {
  const un = user.username?.trim().toLowerCase();
  if (un && DEMO_USERNAMES.has(un)) return true;
  if (DEMO_FULL_NAMES.has(user.fullName.trim())) return true;
  const email = user.email?.trim().toLowerCase();
  if (email?.endsWith("@seed.local")) return true;
  if (email === "employee1@test.com" || email === "employee2@test.com") return true;
  return false;
}

export function activityDashboardUserWhere(): Prisma.UserWhereInput {
  return {
    NOT: {
      OR: [
        { username: { in: [...DEMO_USERNAMES] } },
        { fullName: { in: [...DEMO_FULL_NAMES] } },
        { email: { endsWith: "@seed.local" } },
        { email: { in: ["employee1@test.com", "employee2@test.com"] } },
      ],
    },
  };
}

export function activityRoleLabelHe(role: UserRole | string | null | undefined): string {
  if (role === "ADMIN") return "מנהל מערכת";
  if (role === "EMPLOYEE") return "עובד";
  return "משתמש";
}

export function activityPresenceStatus(lastActivityAt: Date | null, now: Date): ActivityPresenceStatus {
  if (!lastActivityAt) return "INACTIVE";
  const diffMin = (now.getTime() - lastActivityAt.getTime()) / 60000;
  return diffMin <= ACTIVITY_ACTIVE_WINDOW_MINUTES ? "ACTIVE" : "INACTIVE";
}

export function activityPresenceStatusLabel(status: ActivityPresenceStatus): string {
  return status === "ACTIVE" ? "פעיל עכשיו" : "לא פעיל";
}

export function formatActivityClockHe(date: Date): string {
  return date.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });
}

/** e.g. "לפני 2 דקות", "לפני 3 שעות" */
export function formatActivityRelativeHe(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 45_000) return "עכשיו";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return diffMin === 1 ? "לפני דקה" : `לפני ${diffMin} דקות`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? "לפני שעה" : `לפני ${diffHr} שעות`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return diffDay === 1 ? "לפני יום" : `לפני ${diffDay} ימים`;
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" });
}

export function formatLastActivityHe(lastActivityAt: Date | null, now = new Date()): string {
  if (!lastActivityAt) return "אין פעילות רשומה";
  return formatActivityRelativeHe(lastActivityAt, now);
}
