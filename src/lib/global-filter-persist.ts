import { persistGlobalCountry, readPersistedCountry, resolveGlobalCountry } from "@/lib/current-country";
import { getActiveWorkWeekRange } from "@/lib/active-work-week";
import { getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";
import type { OrderCountryCode } from "@/lib/order-countries";

export { readPersistedCountry, persistGlobalCountry, resolveGlobalCountry };

/** שבוע שנבחר במסך הבית — נשמר לניווט בין מסכים, לא כ-default בכניסה חדשה */
export const LS_SELECTED_WEEK = "selectedWeek";

/** תאימות לאחור עם מסכים שקוראים globalWeek */
export const LS_GLOBAL_WEEK = "globalWeek";
export const LS_GLOBAL_FROM = "globalFrom";
export const LS_GLOBAL_TO = "globalTo";
export const LS_GLOBAL_COUNTRY = "globalCountry";

export function readPersistedWorkWeekCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_SELECTED_WEEK) || localStorage.getItem(LS_GLOBAL_WEEK) || "";
    return normalizeAhWeekCode(raw.trim()) ?? null;
  } catch {
    return null;
  }
}

export function persistGlobalFilterWeek(
  weekCode: string,
  fromYmd: string,
  toYmd: string,
  country?: string,
): void {
  if (typeof window === "undefined") return;
  const norm = normalizeAhWeekCode(weekCode);
  if (!norm) return;
  try {
    localStorage.setItem(LS_SELECTED_WEEK, norm);
    localStorage.setItem(LS_GLOBAL_WEEK, norm);
    localStorage.setItem(LS_GLOBAL_FROM, fromYmd);
    localStorage.setItem(LS_GLOBAL_TO, toYmd);
    if (country) persistGlobalCountry(country as OrderCountryCode);
  } catch {
    // ignore
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** טווח שמור (למשל «היום») — חייב להיות בתוך שבוע AH הנבחר */
function storedRangeFitsWeek(weekCode: string, fromYmd: string, toYmd: string): boolean {
  const r = getAhWeekRange(weekCode);
  if (!r) return false;
  return fromYmd >= r.from && toYmd <= r.to;
}

export function resolveGlobalFilterWeekFromStorage(): {
  weekCode: string;
  fromYmd: string;
  toYmd: string;
} {
  /**
   * כניסה חדשה / URL בלי week — תמיד השבוע העסקי החי.
   * שבוע היסטורי מ-localStorage (AH-137 וכו') אינו default.
   * בחירה ידנית חיה רק דרך URL אחרי שהמשתמש עבר שבוע.
   */
  const active = getActiveWorkWeekRange();
  return {
    weekCode: active.weekCode,
    fromYmd: active.fromYmd,
    toYmd: active.toYmd,
  };
}

export function isGlobalFilterUrlReady(
  weekRaw: string | null,
  fromRaw: string | null,
  toRaw: string | null,
  countryRaw: string | null,
): boolean {
  const weekCode = normalizeAhWeekCode(weekRaw?.trim() ?? "");
  if (!weekCode || !YMD_RE.test(fromRaw ?? "") || !YMD_RE.test(toRaw ?? "")) return false;
  const fromYmd = fromRaw!;
  const toYmd = toRaw!;
  if (fromYmd > toYmd) return false;
  if (!storedRangeFitsWeek(weekCode, fromYmd, toYmd)) return false;
  return !!countryRaw?.trim();
}
