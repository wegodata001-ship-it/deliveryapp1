import { DEFAULT_WEEK_CODE, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

/**
 * ברירת מחדל לשבוע קליטה = שבוע העבודה הגלובלי (לא שבוע המקור).
 * נתוני ההזמנות נגזרים בנפרד דרך resolveOrderSourceWeekCode / prevWeekCode.
 */
export function defaultPaymentIntakeWeekCode(fromGlobalWeek: string = DEFAULT_WEEK_CODE): string {
  return normalizeAhWeekCode(fromGlobalWeek) ?? DEFAULT_WEEK_CODE;
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
