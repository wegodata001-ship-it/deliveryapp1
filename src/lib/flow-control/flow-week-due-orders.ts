/**
 * מדיניות גבייה: הזמנה בשבוע N מיועדת לגבייה בשבוע N+1 (כלל עסקי WEGO).
 * READ-ONLY helpers — לא משנים weekCode בהזמנות.
 */
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";

/** שבוע גבייה מתוכנן להזמנות שנוצרו ב-orderWeek */
export function dueCollectionWeekForOrderWeek(orderWeek: string): string {
  const n = parseAhWeekNumber(orderWeek);
  if (n == null) return orderWeek.trim();
  return toAhWeekCode(n + 1);
}

/** שבוע הזמנה שמקורו לגבייה בשבוע dueWeek (N+1 ← N) */
export function orderWeekForDueCollectionWeek(dueWeek: string): string | null {
  const n = parseAhWeekNumber(dueWeek);
  if (n == null || n <= 1) return null;
  return toAhWeekCode(n - 1);
}
