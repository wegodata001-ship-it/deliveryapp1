import {
  balancesSnapshotToYmd,
  DEFAULT_WEEK_CODE,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";

/** שבוע עבודה פעיל (AH נוכחי) — מעודכן דינמית לפי לוח AH */
export const ACTIVE_WORK_WEEK_CODE = DEFAULT_WEEK_CODE;

export type ActiveWorkWeekRange = {
  weekCode: string;
  fromYmd: string;
  toYmd: string;
};

export function getActiveWorkWeekRange(): ActiveWorkWeekRange {
  const weekCode = ACTIVE_WORK_WEEK_CODE;
  const r = getAhWeekRange(weekCode);
  return {
    weekCode,
    fromYmd: r?.from ?? "",
    toYmd: r?.to ?? "",
  };
}

export function balancesActiveWeekQuery(): { week: string; to: string } {
  const { weekCode } = getActiveWorkWeekRange();
  return { week: weekCode, to: balancesSnapshotToYmd(weekCode) };
}

export function isActiveWorkWeekCode(code: string | null | undefined): boolean {
  const norm = normalizeAhWeekCode(code);
  return norm === ACTIVE_WORK_WEEK_CODE;
}

export const WEEK_SCOPED_ADMIN_PATHS = ["/admin/orders", "/admin/balances"] as const;

export function isWeekScopedAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/admin/orders" || pathname === "/admin/balances";
}
