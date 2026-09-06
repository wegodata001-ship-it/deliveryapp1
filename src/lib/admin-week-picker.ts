import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { listAhWeekCodesAround } from "@/lib/weeks/ah-week";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";

const WEEK_RE = /^AH-(\d+)$/i;

export function weekNumber(code: string): number {
  const m = WEEK_RE.exec(code.trim().toUpperCase());
  if (!m?.[1]) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * סינון מקומי בלבד: "139" ו-"AH-139" מוצאים את AH-139.
 * אסור לקרוא ל-API / router בזמן הקלדה.
 */
export function weekMatchesQuery(weekCode: string, query: string): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const week = weekCode.trim().toUpperCase();
  const q = raw.toUpperCase();
  if (week.includes(q)) return true;
  const weekNum = week.replace(/^AH-/, "");
  const qNum = q.replace(/^AH-?/, "");
  return Boolean(qNum) && weekNum.includes(qNum);
}

export function listAdminWeekPickerOptions(selectedWeek: string, query = ""): string[] {
  const selected = normalizeAhWeekCode(selectedWeek) ?? DEFAULT_WEEK_CODE;
  const merged = new Set<string>([
    ...WORK_WEEK_CODES_SORTED,
    ...listAhWeekCodesAround(selected, 120, 60),
    selected,
    ACTIVE_WORK_WEEK_CODE,
  ]);

  const typed = parseAhWeekNumber(query) ?? parseAhWeekNumber(`AH-${query.trim()}`);
  if (typed != null) {
    const extra = `AH-${typed}`;
    if (getAhWeekRange(extra)) merged.add(extra);
  }

  return [...merged]
    .filter((w) => Boolean(normalizeAhWeekCode(w) && getAhWeekRange(w)))
    .sort((a, b) => weekNumber(b) - weekNumber(a));
}
