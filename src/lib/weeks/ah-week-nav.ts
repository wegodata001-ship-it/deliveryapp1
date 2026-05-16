import { normalizeAhWeekCode } from "@/lib/work-week";

const WEEK_RE = /^AH-(\d+)$/i;

/** מספר שבוע מקוד AH (AH-122 → 122) */
export function parseAhWeekNumber(code: string | null | undefined): number | null {
  const norm = normalizeAhWeekCode(code ?? "") ?? (code ?? "").trim().toUpperCase();
  const m = WEEK_RE.exec(norm);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function toAhWeekCode(n: number): string {
  return `AH-${Math.max(1, Math.floor(n))}`;
}

/**
 * הזזת מספר שבוע בזמן:
 * delta -1 = שבוע קודם (אחורה), +1 = שבוע הבא (קדימה).
 */
export function shiftAhWeekNumber(n: number, delta: -1 | 1): number {
  return Math.max(1, Math.floor(n) + delta);
}

/** AH-122 → AH-121 */
export function goToPrevWeekNumber(n: number): number {
  return shiftAhWeekNumber(n, -1);
}

/** AH-122 → AH-123 */
export function goToNextWeekNumber(n: number): number {
  return shiftAhWeekNumber(n, 1);
}

/** הזזת קוד שבוע: delta -1 = קודם, +1 = הבא */
export function shiftAhWeekCode(code: string, delta: -1 | 1): string | null {
  const n = parseAhWeekNumber(code);
  if (n == null) return null;
  return toAhWeekCode(shiftAhWeekNumber(n, delta));
}

/** AH-122 → AH-121 */
export function goToPrevWeek(code: string): string | null {
  return shiftAhWeekCode(code, -1);
}

/** AH-122 → AH-123 */
export function goToNextWeek(code: string): string | null {
  return shiftAhWeekCode(code, 1);
}
