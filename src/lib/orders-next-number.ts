import {
  allocateNextOrderNumberFromCounter,
  peekNextOrderNumberFromCounter,
  type OrderNumberAllocation,
} from "@/lib/order-week-counter";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";

export type { OrderNumberAllocation };

/** מספור רץ לפי שבוע — counter table (לא SELECT MAX על Order) */
export async function generateNextOrderNumber(weekCode: string): Promise<OrderNumberAllocation> {
  return allocateNextOrderNumberFromCounter(weekCode);
}

export function previewOrderNumberAfter(allocation: { orderNumber: string; sequence: number }): string {
  const m = allocation.orderNumber.match(/^(.+)-(\d{4})$/);
  if (!m) return allocation.orderNumber;
  const prefix = m[1];
  const next = String(allocation.sequence + 1).padStart(4, "0");
  return `${prefix}-${next}`;
}

export async function previewNextOrderNumberForWeek(
  weekCode: string,
): Promise<{ weekCode: string; nextOrderNumber: string }> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const peek = await peekNextOrderNumberFromCounter(wc);
  return { weekCode: wc, nextOrderNumber: peek.orderNumber };
}
