import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import {
  DEFAULT_WEEK_CODE,
  getAhWeekRange,
  getBusinessWeekClosingDate,
  normalizeAhWeekCode,
} from "@/lib/work-week";

/**
 * ברירת מחדל לשבוע קליטת תשלום = שבוע העבודה הפעיל/הנבחר.
 *
 * selectedWorkWeek (בית / בורר הקליטה) = שבוע הקליטה = שבוע ההזמנות.
 * דוגמה: בית AH-141 → קליטה AH-141 → הזמנות AH-141
 *
 * paymentDate לא קובע שבוע. לא nextWeek.
 */
export function defaultPaymentIntakeWeekCode(fromHomeWeek: string = DEFAULT_WEEK_CODE): string {
  return normalizeAhWeekCode(fromHomeWeek) ?? DEFAULT_WEEK_CODE;
}

/** תאריך ביצוע קליטה = שבת השבוע הפיננסי (הקודם לשבוע הקליטה במסך). לא תאריך היום. */
export function defaultPaymentIntakeDateYmd(forWeekCode?: string): string {
  const week = forWeekCode?.trim() || defaultPaymentIntakeWeekCode();
  const period = resolvePaymentIntakeAccountingPeriod(week);
  if (period) return period.businessDate;
  return getBusinessWeekClosingDate(week) || getAhWeekRange(DEFAULT_WEEK_CODE)?.to || "";
}
