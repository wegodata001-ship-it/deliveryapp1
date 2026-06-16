import { DEFAULT_WEEK_CODE, getAhWeekRange } from "@/lib/work-week";
import { goToPrevWeek } from "@/lib/weeks/ah-week-nav";

/**
 * ברירת מחדל לשבוע בקליטת תשלום בלבד:
 * השבוע שסגר (currentWeek - 1), כי תשלומים מתבצעים על השבוע שהסתיים.
 */
export function defaultPaymentIntakeWeekCode(fromCurrentWeek: string = DEFAULT_WEEK_CODE): string {
  return goToPrevWeek(fromCurrentWeek) ?? fromCurrentWeek;
}

/** תאריך תשלום ברירת מחדל — סוף שבוע AH שנסגר (יום שבת). */
export function defaultPaymentIntakeDateYmd(forWeekCode?: string): string {
  const week = forWeekCode?.trim() || defaultPaymentIntakeWeekCode();
  const to = getAhWeekRange(week)?.to;
  return to ?? getAhWeekRange(DEFAULT_WEEK_CODE)?.from ?? "";
}
