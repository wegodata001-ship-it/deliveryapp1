import { getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";
import { getAhWeekRange, isValidYmd } from "@/lib/weeks/ah-week";

export type WeekDateRange = {
  startDate: string;
  endDate: string;
};

/** טווח שבוע AH (YYYY-MM-DD) */
export function getWeekRangeFromAH(weekCode: string | null | undefined): WeekDateRange | null {
  const w = getAhWeekRange(weekCode);
  if (!w) return null;
  return { startDate: w.from, endDate: w.to };
}

export function isDateWithinWeek(
  dateYmd: string | null | undefined,
  startYmd: string,
  endYmd: string,
): boolean {
  if (!isValidYmd(dateYmd)) return false;
  return dateYmd >= startYmd && dateYmd <= endYmd;
}

export const WEEK_DATE_RANGE_ERROR = "התאריך חייב להיות בתוך טווח השבוע";

export function validateDateInAhWeek(
  dateYmd: string | null | undefined,
  weekCode: string | null | undefined,
): string | null {
  const range = getWeekRangeFromAH(weekCode);
  if (!range || !isValidYmd(dateYmd)) return WEEK_DATE_RANGE_ERROR;
  return isDateWithinWeek(dateYmd, range.startDate, range.endDate) ? null : WEEK_DATE_RANGE_ERROR;
}

/** 10/05/2026 */
export function formatYmdSlash(ymd: string | null | undefined): string {
  if (!isValidYmd(ymd)) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** ברירת מחדל בתוך השבוע: היום אם בטווח, אחרת יום ראשון */
export function defaultDateInWeekRange(fromYmd: string, toYmd: string, todayYmd?: string): string {
  const today = todayYmd ?? fromYmd;
  if (isDateWithinWeek(today, fromYmd, toYmd)) return today;
  return fromYmd;
}

/** שבוע AH לפי תאריך עסקי (orderDate) בלבד — לא לפי תאריך הזנה / createdAt */
export function deriveAhWeekCodeFromOrderDateYmd(orderDateYmd: string | null | undefined): string | null {
  if (!isValidYmd(orderDateYmd)) return null;
  return getWeekCodeForLocalDate(parseLocalDate(orderDateYmd));
}
