import { getActiveWorkWeekRange } from "@/lib/active-work-week";
import { getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

/** שבוע שנבחר במסך הבית (שבוע קודם/הבא/היום) — נשמר לרענון F5 */
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
    if (country) localStorage.setItem(LS_GLOBAL_COUNTRY, country);
  } catch {
    // ignore
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function readStoredYmdRange(): { from: string; to: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const from = localStorage.getItem(LS_GLOBAL_FROM) || "";
    const to = localStorage.getItem(LS_GLOBAL_TO) || "";
    if (YMD_RE.test(from) && YMD_RE.test(to) && from <= to) return { from, to };
  } catch {
    // ignore
  }
  return null;
}

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
  const active = getActiveWorkWeekRange();
  const saved = readPersistedWorkWeekCode();
  const weekCode = saved ?? active.weekCode;
  const storedRange = readStoredYmdRange();
  if (storedRange && storedRangeFitsWeek(weekCode, storedRange.from, storedRange.to)) {
    return { weekCode, fromYmd: storedRange.from, toYmd: storedRange.to };
  }
  const range = getAhWeekRange(weekCode);
  return {
    weekCode,
    fromYmd: range?.from ?? active.fromYmd,
    toYmd: range?.to ?? active.toYmd,
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
