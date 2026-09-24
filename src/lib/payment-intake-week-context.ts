/**
 * הקשר שבועות בקליטת תשלום — ממוקד למסך הקליטה בלבד.
 *
 * מודל:
 * - selectedWorkWeek (בית / ?week= / בורר הקליטה) = שבוע הקליטה
 * - orderSourceWeek = אותו שבוע (לא previousWeek)
 *
 * ניווט ידני בתוך הקליטה על שבוע P → הזמנות = P.
 * תאריך ביצוע ברירת מחדל (intakeDate / paymentDate) נשאר שבת השבוע הפיננסי (P − 1)
 * לצורך בקרת קופה — בלי לשנות את שבוע הקליטה השמור.
 *
 * לא משנים את השבוע הגלובלי במסך הבית.
 */
import {
  getAhWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
  parseLocalDate,
} from "@/lib/work-week";

export type PaymentIntakeWeekContext = {
  /** שבוע ביצוע הקליטה / שמירת התשלום */
  intakeWeekCode: string;
  /** שבוע מקור ההזמנות — זהה לשבוע הקליטה */
  orderSourceWeekCode: string;
  /** שבת שבוע הקליטה — ברירת מחדל לתאריך הזמנות */
  orderSourceDateYmd: string;
};

export function resolveOrderSourceWeekCode(
  intakeWeekCodeRaw: string | null | undefined,
): string | null {
  const intake = normalizeAhWeekCode(intakeWeekCodeRaw ?? "");
  if (!intake || !getAhWeekRange(intake)) return null;
  return intake;
}

/** שבת (סוף שבוע) של שבוע הקליטה / מקור ההזמנות */
export function defaultOrderSourceDateYmdForIntakeWeek(
  intakeWeekCodeRaw: string | null | undefined,
): string {
  const intake = normalizeAhWeekCode(intakeWeekCodeRaw ?? "");
  if (!intake) return "";
  return getAhWeekRange(intake)?.to ?? "";
}

export function resolvePaymentIntakeWeekContext(
  intakeWeekCodeRaw: string | null | undefined,
): PaymentIntakeWeekContext | null {
  const intakeWeekCode = normalizeAhWeekCode(intakeWeekCodeRaw ?? "");
  if (!intakeWeekCode || !getAhWeekRange(intakeWeekCode)) return null;
  const orderSourceWeekCode = resolveOrderSourceWeekCode(intakeWeekCode);
  if (!orderSourceWeekCode) return null;
  const orderSourceDateYmd = defaultOrderSourceDateYmdForIntakeWeek(intakeWeekCode);
  if (!orderSourceDateYmd) return null;
  return { intakeWeekCode, orderSourceWeekCode, orderSourceDateYmd };
}

/** שבוע AH לפי תאריך הזמנות (לשינוי ידני) */
export function orderSourceWeekCodeFromDateYmd(ymd: string): string | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return normalizeAhWeekCode(getWeekCodeForLocalDate(parseLocalDate(t)));
}

/** week query לטעינת הזמנות — שבוע הקליטה, אלא אם נבחר תאריך מקור ידני */
export function weekCodeForPaymentIntakeOrders(
  intakeWeekCodeRaw: string | null | undefined,
  orderSourceDateYmd?: string | null,
): string | null {
  const manual = orderSourceDateYmd?.trim()
    ? orderSourceWeekCodeFromDateYmd(orderSourceDateYmd)
    : null;
  if (manual) return manual;
  return resolveOrderSourceWeekCode(intakeWeekCodeRaw);
}
