import type { Prisma } from "@prisma/client";
import { endOfLocalDay, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

/**
 * תנאי Prisma לקליטת תשלום: הזמנות עם orderDate עד סוף שבוע AH (שבת כולל),
 * כולל שבועות קודמים. הזמנות ללא תאריך נשארות בתוצאה (לא לנעול חוב בשקט).
 */
export function paymentIntakeOrderDateThroughAhWeekEnd(
  weekCodeRaw: string | null | undefined,
): Prisma.OrderWhereInput | null {
  if (weekCodeRaw == null) return null;
  const t = String(weekCodeRaw).trim();
  if (!t) return null;
  const c = normalizeAhWeekCode(t);
  if (!c) return null;
  const rng = getAhWeekRange(c);
  if (!rng?.to) return null;
  const end = endOfLocalDay(rng.to);
  return {
    OR: [{ orderDate: null }, { orderDate: { lte: end } }],
  };
}
