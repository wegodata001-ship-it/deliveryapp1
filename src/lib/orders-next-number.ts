import {
  allocateNextOrderNumberFromCounter,
  allocateNextOrderNumberResynced,
  peekNextOrderNumberFromCounter,
  type OrderNumberAllocation,
} from "@/lib/order-week-counter";
import { DEFAULT_WORK_COUNTRY, type WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";

export type { OrderNumberAllocation };

/** מספור רץ לפי מדינה+שבוע — counter table */
export async function generateNextOrderNumber(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrderNumberAllocation> {
  return allocateNextOrderNumberFromCounter(weekCode, workCountry);
}

/** הקצאת מספר חדש לאחר התנגשות — מסנכרן את המונה מול ה-MAX האמיתי בטבלה */
export async function regenerateOrderNumberAfterCollision(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrderNumberAllocation> {
  return allocateNextOrderNumberResynced(weekCode, workCountry);
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
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<{ weekCode: string; nextOrderNumber: string }> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const peek = await peekNextOrderNumberFromCounter(wc, workCountry);
  return { weekCode: wc, nextOrderNumber: peek.orderNumber };
}
