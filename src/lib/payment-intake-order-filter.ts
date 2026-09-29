import type { Prisma } from "@prisma/client";
import { endOfLocalDay, getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

/**
 * תנאי Prisma לקליטת תשלום: הזמנות עם orderDate עד סוף שבוע מקור AH (שבת כולל),
 * כולל שבועות קודמים. weekCodeRaw = שבוע מקור ההזמנות (לא שבוע הקליטה).
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

export function paymentIntakeAhWeekEnd(
  weekCodeRaw: string | null | undefined,
): Date | null {
  if (weekCodeRaw == null) return null;
  const t = String(weekCodeRaw).trim();
  if (!t) return null;
  const c = normalizeAhWeekCode(t);
  if (!c) return null;
  const rng = getAhWeekRange(c);
  if (!rng?.to) return null;
  return endOfLocalDay(rng.to);
}

/** תואם Prisma: orderDate null או orderDate <= סוף שבוע AH */
export function orderDateIsThroughAhWeekEnd(
  orderDate: Date | string | null | undefined,
  weekCodeRaw: string | null | undefined,
): boolean {
  const end = paymentIntakeAhWeekEnd(weekCodeRaw);
  if (!end) return true;
  if (orderDate == null || orderDate === "") return true;
  const d = orderDate instanceof Date ? orderDate : new Date(orderDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= end.getTime();
}

/**
 * הזמנה זכאית לשבוע הקליטה שנבחר — לפי תאריך בלבד.
 * יתרה פתוחה בשבוע עתידי אינה מרחיבה את הסקופ.
 */
export function intakeOrderEligibleForSelectedWeek(params: {
  orderDate: Date | string | null | undefined;
  weekCodeRaw: string | null | undefined;
}): boolean {
  return orderDateIsThroughAhWeekEnd(params.orderDate, params.weekCodeRaw);
}

export function sumPaymentIntakeWeekScopedRemainingUsd(
  orders: ReadonlyArray<{ dbRemainingUsd?: string | number | null }>,
): number {
  let sum = 0;
  for (const order of orders) {
    const n = Number(order.dbRemainingUsd ?? 0);
    if (Number.isFinite(n)) sum += n;
  }
  return Math.round(sum * 100) / 100;
}
