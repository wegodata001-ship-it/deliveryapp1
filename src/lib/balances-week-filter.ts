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

/**
 * קריאת פילטר שבוע יתרות מ-URL.
 * SSOT מקומי: balancesWeek בלבד. לא לקרוא week=/from=/to= הגלובליים —
 * אחרת שני מקורות מתקנים אחד את השני בלולאה.
 */
export function parseBalancesWeekFromSearchParams(sp: URLSearchParams): BalancesWeekScope {
  const weekCode = normalizeAhWeekCode(sp.get(BALANCES_WEEK_PARAM)?.trim() || "") ?? "";

  const toParam = sp.get(BALANCES_TO_PARAM)?.trim() || "";
  const toYmd = weekCode
    ? YMD_RE.test(toParam)
      ? toParam
      : balancesSnapshotToYmd(weekCode)
    : "";

  const fromRaw = sp.get(BALANCES_FROM_PARAM)?.trim() || "";
  const rangeToRaw = sp.get(BALANCES_RANGE_TO_PARAM)?.trim() || "";

  return {
    weekCode,
    toYmd,
    rangeFromYmd: YMD_RE.test(fromRaw) ? fromRaw : "",
    rangeToYmd: YMD_RE.test(rangeToRaw) ? rangeToRaw : "",
  };
}

export function isBalancesWeekReady(sp: Pick<URLSearchParams, "get">): boolean {
  return Boolean(normalizeAhWeekCode(sp.get(BALANCES_WEEK_PARAM)?.trim() || ""));
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

export type BalancesLocalWeekResync = "seed" | "sync-global" | "ensure-to" | "skip";

/**
 * balancesWeek הוא פילטר מקומי. לסנכרן ל-week הגלובלי רק בכניסה ראשונה
 * בלי פרמטר, או כשהשבוע הגלובלי עצמו השתנה — לא כשהמשתמש מנווט מקומית.
 */
export function shouldResyncBalancesLocalWeek(input: {
  currentBalancesWeek: string;
  currentBalancesTo: string;
  globalWorkWeek: string;
  previousGlobalWorkWeek: string | null;
}): BalancesLocalWeekResync {
  const firstEnter = input.previousGlobalWorkWeek === null;
  if (firstEnter) {
    if (!input.currentBalancesWeek) return "seed";
    if (!input.currentBalancesTo) return "ensure-to";
    return "skip";
  }
  if (input.previousGlobalWorkWeek !== input.globalWorkWeek) return "sync-global";
  return "skip";
}
