/**
 * תקופה חשבונאית של קליטת תשלום — מקור אמת יחיד.
 *
 * שבוע העבודה במסך הקליטה = Intake Week (N)
 * השבוע הפיננסי של התשלומים = N − 1
 * תאריך ביצוע / בקרת קופה = שבת סגירת השבוע הקודם
 *
 * דוגמה: AH-135 → financial AH-134 → 2026-08-08
 *
 * לא מחסרים 7 ימים ידנית — רק לוח AH (prevWeek + closing Saturday).
 */
import {
  getAhWeekRange,
  getBusinessWeekClosingDate,
  normalizeAhWeekCode,
  prevWeekCode,
} from "@/lib/work-week";

export type PaymentIntakeAccountingPeriod = {
  intakeWeek: string;
  financialWeek: string;
  businessDate: string;
};

export function resolvePaymentIntakeAccountingPeriod(
  intakeWeekRaw: string | null | undefined,
): PaymentIntakeAccountingPeriod | null {
  const intakeWeek = normalizeAhWeekCode(intakeWeekRaw ?? "");
  if (!intakeWeek || !getAhWeekRange(intakeWeek)) return null;
  const financialWeek = prevWeekCode(intakeWeek);
  if (!financialWeek) return null;
  const businessDate = getBusinessWeekClosingDate(financialWeek);
  if (!businessDate) return null;
  return { intakeWeek, financialWeek, businessDate };
}
