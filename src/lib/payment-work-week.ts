/**
 * שבוע עבודה של קליטת תשלום — נפרד מ-paymentDate.
 *
 * Source of Truth = השבוע שנבחר במסך הקליטה (weekDraft / form.weekCode).
 * paymentDate הוא תאריך התשלום בלבד. אסור לגזור ממנו weekCode.
 */
import { getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

export const PAYMENT_WORK_WEEK_REQUIRED_ERROR = "חסר שבוע קליטה";

/** שבוע שנשלח מהמסך — בלי fallback לתאריך תשלום */
export function resolveSubmittedPaymentWorkWeek(
  weekCodeRaw: string | null | undefined,
): string | null {
  const week = normalizeAhWeekCode(weekCodeRaw ?? "");
  if (!week || !getAhWeekRange(week)) return null;
  return week;
}
