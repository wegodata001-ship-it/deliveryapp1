import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import {
  balancesSnapshotToYmd,
  normalizeAhWeekCode,
} from "@/lib/work-week";

/** פרמטרי URL לפילטר שבוע מקומי בדוח יתרות — לא משפיעים על השבוע הגלובלי (`week`) */
export const BALANCES_WEEK_PARAM = "balancesWeek";
export const BALANCES_TO_PARAM = "balancesTo";
/** טווח תאריכים לסינון הזמנות/תשלומים — נפרד מ-snapshot */
export const BALANCES_FROM_PARAM = "balancesFrom";
export const BALANCES_RANGE_TO_PARAM = "balancesRangeTo";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BalancesWeekScope = {
  weekCode: string;
  toYmd: string;
  rangeFromYmd: string;
  rangeToYmd: string;
};

/** קריאת פילטר שבוע יתרות מ-URL — לא קורא `week` / `to` הגלובליים */
export function parseBalancesWeekFromSearchParams(sp: URLSearchParams): BalancesWeekScope {
  const weekRaw = sp.get(BALANCES_WEEK_PARAM)?.trim() || "";
  const weekCode = normalizeAhWeekCode(weekRaw) ?? ACTIVE_WORK_WEEK_CODE;

  const toParam = sp.get(BALANCES_TO_PARAM)?.trim() || "";
  const toYmd = YMD_RE.test(toParam) ? toParam : balancesSnapshotToYmd(weekCode);

  const fromRaw = sp.get(BALANCES_FROM_PARAM)?.trim() || "";
  const rangeToRaw = sp.get(BALANCES_RANGE_TO_PARAM)?.trim() || "";

  return {
    weekCode,
    toYmd,
    rangeFromYmd: YMD_RE.test(fromRaw) ? fromRaw : "",
    rangeToYmd: YMD_RE.test(rangeToRaw) ? rangeToRaw : "",
  };
}

export function balancesWeekQueryPatch(
  weekCode: string,
  toYmd: string,
  rangeFromYmd?: string,
  rangeToYmd?: string,
): Record<string, string | null> {
  return {
    [BALANCES_WEEK_PARAM]: weekCode.trim() || null,
    [BALANCES_TO_PARAM]: toYmd.trim() || null,
    [BALANCES_FROM_PARAM]: rangeFromYmd?.trim() || null,
    [BALANCES_RANGE_TO_PARAM]: rangeToYmd?.trim() || null,
    upto: null,
    modal: null,
  };
}
