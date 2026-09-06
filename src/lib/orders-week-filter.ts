import { getAhWeekRange, normalizeAhWeekCode } from "@/lib/work-week";

/** פילטר שבוע מקומי ברשימת הזמנות — SSOT. week=/from=/to= הם שיקוף לכרום בלבד. */
export const ORDERS_WEEK_PARAM = "ordersWeek";
export const ORDERS_FROM_PARAM = "ordersFrom";
export const ORDERS_TO_PARAM = "ordersTo";

export type OrdersLocalWeekResync = "seed" | "align-chrome" | "sync-global" | "skip";

export function ordersWeekRangePatch(weekCode: string): Record<string, string> {
  const week = normalizeAhWeekCode(weekCode) ?? weekCode.trim();
  const range = getAhWeekRange(week);
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  return {
    [ORDERS_WEEK_PARAM]: week,
    [ORDERS_FROM_PARAM]: from,
    [ORDERS_TO_PARAM]: to,
    week,
    from,
    to,
  };
}

/**
 * ordersWeek הוא הפילטר המקומי.
 * לסנכרן מ-week הגלובלי רק בכניסה בלי פרמטר, או כשהשבוע הגלובלי עצמו השתנה.
 * אסור לדרוס בחירת משתמש רק כי week= עדיין לא עודכן.
 */
export function shouldResyncOrdersLocalWeek(input: {
  currentOrdersWeek: string;
  globalWorkWeek: string;
  previousGlobalWorkWeek: string | null;
}): OrdersLocalWeekResync {
  if (!input.currentOrdersWeek) return "seed";
  const firstEnter = input.previousGlobalWorkWeek === null;
  if (firstEnter) return "align-chrome";
  if (input.previousGlobalWorkWeek !== input.globalWorkWeek) {
    if (input.currentOrdersWeek === input.globalWorkWeek) return "skip";
    return "sync-global";
  }
  return "skip";
}
