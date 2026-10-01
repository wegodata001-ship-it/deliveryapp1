/**
 * שבוע עבודה גלובלי (SSOT) — נגזר מפרמטר URL `week`.
 *
 * globalWorkWeek = שבוע שנבחר בבית (שבוע הזמנות / דשבורד / יתרות לפי מסך).
 * בלי week ב-URL / כניסה חדשה: getCurrentBusinessWeek().
 *
 * קליטת תשלום: ברירת המחדל בפתיחה = previous business week
 * (ראו payment-intake-default-week). אין לשנות את השבוע הגלובלי בעת כניסה לקליטה.
 * paymentDate אינו קובע שבוע קליטה.
 *
 * sourceWeekCode כאן נשאר prev(global) לתאימות יתרות/snapshot קיימים — לא משמש
 * כברירת מחדל לשבוע הקליטה.
 */
import {
  balancesSnapshotToYmd,
  getAhWeekRange,
  getCurrentBusinessWeek,
  normalizeAhWeekCode,
  prevWeekCode,
} from "@/lib/work-week";

export type GlobalWorkWeekScope = {
  /** שבוע עבודה גלובלי — מה שנבחר בחלק העליון / ?week= */
  globalWorkWeek: string;
  fromYmd: string;
  toYmd: string;
  /** שבוע מקור לקליטת תשלום ויתרות (AH-N → AH-(N-1) דרך טבלת שבועות AH) */
  sourceWeekCode: string | null;
  /** שבת שבוע המקור — ברירת מחדל ל-snapshot יתרות / תאריך הזמנות בקליטה */
  sourceSnapshotToYmd: string;
};

export function resolveGlobalWorkWeek(
  weekParam: string | null | undefined,
  fallback: string = getCurrentBusinessWeek().currentBusinessWeekId,
): string {
  return normalizeAhWeekCode(weekParam ?? "") ?? fallback;
}

/** שבוע מקור לקליטת תשלום ויתרות — לא weekNumber-1 עיוור, אלא getPrevAhWeek דרך prevWeekCode */
export function resolveSourceWeekForPaymentAndBalances(
  globalWorkWeek: string | null | undefined,
): string | null {
  const global = normalizeAhWeekCode(globalWorkWeek ?? "");
  if (!global) return null;
  return prevWeekCode(global);
}

export function resolveGlobalWorkWeekScope(
  weekParam: string | null | undefined,
  fallback: string = getCurrentBusinessWeek().currentBusinessWeekId,
): GlobalWorkWeekScope {
  const globalWorkWeek = resolveGlobalWorkWeek(weekParam, fallback);
  const range = getAhWeekRange(globalWorkWeek);
  const sourceWeekCode = resolveSourceWeekForPaymentAndBalances(globalWorkWeek);
  const sourceSnapshotToYmd =
    balancesSnapshotToYmd(globalWorkWeek) ||
    (sourceWeekCode ? (getAhWeekRange(sourceWeekCode)?.to ?? "") : "");

  return {
    globalWorkWeek,
    fromYmd: range?.from ?? "",
    toYmd: range?.to ?? "",
    sourceWeekCode,
    sourceSnapshotToYmd,
  };
}
