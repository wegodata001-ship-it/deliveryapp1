import {
  balancesSnapshotToYmd,
  getCurrentBusinessWeek,
  normalizeAhWeekCode,
} from "@/lib/work-week";

/** שבוע עבודה פעיל (AH נוכחי) — נגזר מ-getCurrentBusinessWeek() בכל קריאה */
export const ACTIVE_WORK_WEEK_CODE = getCurrentBusinessWeek().currentBusinessWeekId;

export type ActiveWorkWeekRange = {
  weekCode: string;
  fromYmd: string;
  toYmd: string;
};

export function getActiveWorkWeekRange(): ActiveWorkWeekRange {
  const current = getCurrentBusinessWeek();
  return {
    weekCode: current.currentBusinessWeekId,
    fromYmd: current.startDate,
    toYmd: current.endDate,
  };
}

export function balancesActiveWeekQuery(): { balancesWeek: string; balancesTo: string } {
  const { weekCode } = getActiveWorkWeekRange();
  return { balancesWeek: weekCode, balancesTo: balancesSnapshotToYmd(weekCode) };
}

export function isActiveWorkWeekCode(code: string | null | undefined): boolean {
  const norm = normalizeAhWeekCode(code);
  return norm === getCurrentBusinessWeek().currentBusinessWeekId;
}

export const WEEK_SCOPED_ADMIN_PATHS = ["/admin/orders", "/admin/balances"] as const;

export function isWeekScopedAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/admin/orders" || pathname === "/admin/balances";
}
