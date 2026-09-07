import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import {
  DEFAULT_WEEK_CODE,
  getAhWeekRange,
  getBusinessWeekClosingDate,
  nextWeekCode,
  normalizeAhWeekCode,
} from "@/lib/work-week";

/**
 * ברירת מחדל לשבוע קליטת תשלום מתוך שבוע הבית / השבוע הגלובלי שנבחר.
 *
 * selectedWorkWeek (בית) = שבוע ההזמנות
 * paymentCaptureWeek = nextWeek(selectedWorkWeek)
 *
 * דוגמה: בית AH-136 → קליטה AH-137 → הזמנות AH-136
 *
 * לא משנה את השבוע הגלובלי — רק מחשב שבוע קליטה מקומי למסך הקליטה.
 */
export function defaultPaymentIntakeWeekCode(fromHomeWeek: string = DEFAULT_WEEK_CODE): string {
  const home = normalizeAhWeekCode(fromHomeWeek) ?? DEFAULT_WEEK_CODE;
  return nextWeekCode(home) ?? home;
}

/** תאריך ביצוע קליטה = שבת השבוע הפיננסי (הקודם לשבוע הקליטה במסך). לא תאריך היום. */
export function defaultPaymentIntakeDateYmd(forWeekCode?: string): string {
  const week = forWeekCode?.trim() || defaultPaymentIntakeWeekCode();
  const period = resolvePaymentIntakeAccountingPeriod(week);
  if (period) return period.businessDate;
  return getBusinessWeekClosingDate(week) || getAhWeekRange(DEFAULT_WEEK_CODE)?.to || "";
}
