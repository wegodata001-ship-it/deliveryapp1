import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import {
  getAhWeekRange,
  getBusinessWeekClosingDate,
  getCurrentBusinessWeek,
  normalizeAhWeekCode,
  prevWeekCode,
} from "@/lib/work-week";

/**
 * ברירת מחדל לשבוע קליטת תשלום = השבוע העסקי הקודם (previous business week).
 *
 * CURRENT BUSINESS WEEK = AH-141 → קליטה AH-140
 * CURRENT BUSINESS WEEK = AH-142 → קליטה AH-141
 *
 * חל רק בפתיחת קליטה חדשה. ניווט ידני בתוך הקליטה נשמר.
 * לא משנה את שבוע הבית / דשבורד / יתרות.
 */
export function defaultPaymentIntakeWeekCode(fromCurrentBusinessWeek?: string): string {
  const current =
    normalizeAhWeekCode(fromCurrentBusinessWeek ?? "") ??
    getCurrentBusinessWeek().currentBusinessWeekId;
  return prevWeekCode(current) ?? current;
}

/** תאריך ביצוע קליטה = שבת השבוע הפיננסי (הקודם לשבוע הקליטה במסך). לא תאריך היום. */
export function defaultPaymentIntakeDateYmd(forWeekCode?: string): string {
  const week = forWeekCode?.trim() || defaultPaymentIntakeWeekCode();
  const period = resolvePaymentIntakeAccountingPeriod(week);
  if (period) return period.businessDate;
  return getBusinessWeekClosingDate(week) || getAhWeekRange(getCurrentBusinessWeek().currentBusinessWeekId)?.to || "";
}
