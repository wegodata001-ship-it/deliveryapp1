import { balancesSnapshotToYmd, normalizeAhWeekCode } from "@/lib/work-week";
import { resolveBalancesWeekFinancialScope } from "@/lib/customer-financial-scope";

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

  const toYmd = weekCode ? balancesSnapshotToYmd(weekCode) : "";

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

export type BalancesLocalWeekResync = "seed" | "ensure-to" | "skip";

/**
 * קישור סיידבר / כניסה ליתרות: אם כבר יש שבוע מקומי — לא לדרוס אותו
 * בשבוע הגלובלי (`week=`). אחרת שני כותבים מתקנים אחד את השני (AH-N ↔ AH-N+1).
 */
export function resolveBalancesWeekForNav(
  currentBalancesWeek: string | null | undefined,
  globalWorkWeek: string,
): string {
  return normalizeAhWeekCode(currentBalancesWeek) || normalizeAhWeekCode(globalWorkWeek) || "";
}

/** כתיבה ל-URL רק כדי לזרוע balancesWeek חסר, או אחרי שינוי מקומי של המשתמש. */
export function shouldWriteBalancesLocalWeek(input: {
  urlBalancesWeek: string;
  stateWeekCode: string;
  userChangedLocalWeek: boolean;
}): boolean {
  const state = normalizeAhWeekCode(input.stateWeekCode) ?? "";
  if (!state) return false;
  const url = normalizeAhWeekCode(input.urlBalancesWeek) ?? "";
  if (!url) return input.userChangedLocalWeek;
  return input.userChangedLocalWeek && url !== state;
}

function formatHeYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd.trim();
}

/** טקסט מסך יתרות — לפי cutoff אמיתי, לא «עד היום». */
export function balancesCumulativeCutoffCaption(input: {
  selectedWeekCode: string;
  cutoffWeekCode?: string | null;
  cutoffYmd: string;
  scopeKind?: "CURRENT" | "HISTORICAL";
}): string {
  const week = input.selectedWeekCode.trim();
  if (input.scopeKind === "CURRENT") {
    return week ? `מצב יתרות נוכחי · ${week}` : "מצב יתרות נוכחי";
  }
  const cutoffWeek = (input.cutoffWeekCode ?? week).trim();
  const date = formatHeYmd(input.cutoffYmd);
  if (cutoffWeek && date) return `יתרות מצטברות עד סוף ${date} · ${cutoffWeek}`;
  if (date) return `מצב יתרות נכון ל־${date}`;
  if (week) return `יתרות לפי שבוע עבודה ${week}`;
  return "יתרות מצטברות";
}

/** כותרת כרטסת שנפתחה ממסך יתרות — אותו cutoff. */
export function customerCardBalancesCutoffCaption(input: {
  selectedWeekCode: string;
  cutoffYmd: string;
}): string {
  const date = formatHeYmd(input.cutoffYmd);
  const week = input.selectedWeekCode.trim();
  if (date && week) return `כרטסת עד ${date} — לפי שבוע עבודה ${week}`;
  if (date) return `כרטסת עד ${date}`;
  return "כרטסת לפי שבוע העבודה שנבחר";
}

/** פרמטרים לפתיחת כרטסת מתוך מסך יתרות — אותו cutoff, בלי חישוב מחדש במודל. */
export function balancesCardOpenProps(input: {
  weekCode: string;
  snapshotToYmd: string;
  rangeFromYmd?: string;
  rangeToYmd?: string;
  sourceCountry?: string | null;
}): {
  ledgerFromYmd: string | null;
  ledgerToYmd: string | null;
  ledgerSelectedWeekCode: string | null;
  ledgerCutoffWeekCode: string | null;
  ledgerSourceCountry: string | null;
} {
  const rangeFrom = (input.rangeFromYmd ?? "").trim();
  const rangeTo = (input.rangeToYmd ?? "").trim();
  const week = input.weekCode.trim();
  const country = (input.sourceCountry ?? "").trim() || null;
  if (rangeFrom || rangeTo) {
    return {
      ledgerFromYmd: rangeFrom || null,
      ledgerToYmd: rangeTo || null,
      ledgerSelectedWeekCode: week || null,
      ledgerCutoffWeekCode: null,
      ledgerSourceCountry: country,
    };
  }
  const resolved = resolveBalancesWeekFinancialScope({ selectedWeekCode: week });
  const historical = resolved.financial.kind === "HISTORICAL";
  return {
    ledgerFromYmd: null,
    ledgerToYmd: historical ? resolved.cutoffYmd || input.snapshotToYmd.trim() || null : null,
    ledgerSelectedWeekCode: week || null,
    ledgerCutoffWeekCode: week || null,
    ledgerSourceCountry: country,
  };
}

export function customerCardLedgerViewMode(input: {
  parentFromYmd?: string | null;
  parentToYmd?: string | null;
  currentFromYmd: string;
  currentToYmd: string;
}): "parent-cutoff" | "lifetime" | "custom" {
  const parentFrom = (input.parentFromYmd ?? "").trim();
  const parentTo = (input.parentToYmd ?? "").trim();
  const from = input.currentFromYmd.trim();
  const to = input.currentToYmd.trim();
  if (!parentFrom && !parentTo) return from || to ? "custom" : "lifetime";
  if (from === parentFrom && to === parentTo) return "parent-cutoff";
  if (!from && !to) return "lifetime";
  return "custom";
}

/**
 * balancesWeek הוא פילטר מקומי ו-SSOT יחיד.
 * לזרוע מ-week הגלובלי רק כשחסר balancesWeek.
 * אסור לסנכרן חזרה ל-week= אחרי שהשבוע המקומי כבר קיים
 * (remount, prefetch, או שינוי week גלובלי בזמן שהמשתמש ב-AH אחר).
 */
export function shouldResyncBalancesLocalWeek(input: {
  currentBalancesWeek: string;
  currentBalancesTo: string;
  globalWorkWeek: string;
  previousGlobalWorkWeek: string | null;
}): BalancesLocalWeekResync {
  void input.globalWorkWeek;
  void input.previousGlobalWorkWeek;
  if (!input.currentBalancesWeek) return "seed";
  if (!input.currentBalancesTo) return "ensure-to";
  return "skip";
}
