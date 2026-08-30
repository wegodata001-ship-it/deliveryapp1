import {
  DEFAULT_WEEK_CODE,
  getAhWeekRange,
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

/**
 * @deprecated השתמש ב-`defaultOrderSourceDateYmdForIntakeWeek` לתאריך הזמנות,
 * וב-`formatLocalYmd(new Date())` לתאריך ביצוע תשלום.
 */
export function defaultPaymentIntakeDateYmd(forWeekCode?: string): string {
  const week = forWeekCode?.trim() || defaultPaymentIntakeWeekCode();
  const to = getAhWeekRange(week)?.to;
  return to ?? getAhWeekRange(DEFAULT_WEEK_CODE)?.from ?? "";
}
