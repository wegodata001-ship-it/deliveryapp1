/**
 * הקשר שבועות בקליטת תשלום — ממוקד למסך הקליטה בלבד.
 *
 * שבוע עבודה (קליטה) AH-N → הזמנות משבוע מקור AH-(N-1) → שבת AH-(N-1).
 * תאריך התשלום (paymentDateYmd) נפרד — לא נגזר מהשבוע.
 */
import {
  balancesSnapshotToYmd,
  getAhWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
  parseLocalDate,
  prevWeekCode,
} from "@/lib/work-week";

export type PaymentIntakeWeekContext = {
  /** שבוע ביצוע הקליטה / שמירת התשלום */
  intakeWeekCode: string;
  /** שבוע מקור ההזמנות (שבוע קודם) */
  orderSourceWeekCode: string;
  /** שבת שבוע מקור ההזמנות — ברירת מחדל לתאריך הזמנות */
  orderSourceDateYmd: string;
};

export function resolveOrderSourceWeekCode(
  intakeWeekCodeRaw: string | null | undefined,
): string | null {
  const intake = normalizeAhWeekCode(intakeWeekCodeRaw ?? "");
  if (!intake) return null;
  return prevWeekCode(intake);
}

/** שבת (סוף שבוע) של שבוע מקור ההזמנות עבור שבוע קליטה AH-N */
export function defaultOrderSourceDateYmdForIntakeWeek(
  intakeWeekCodeRaw: string | null | undefined,
): string {
  const intake = normalizeAhWeekCode(intakeWeekCodeRaw ?? "");
  if (!intake) return "";
  const snap = balancesSnapshotToYmd(intake);
  if (snap) return snap;
  const src = resolveOrderSourceWeekCode(intake);
  return src ? (getAhWeekRange(src)?.to ?? "") : "";
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

/** week query לטעינת הזמנות — שבוע מקור, לא שבוע קליטה */
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
