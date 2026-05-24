import { isLegacyOrderStatusSlug, OS } from "@/lib/order-status-slugs";

/** מפתחות ריבועי KPI ברשימת הזמנות — תואם ל-orders-list-data.ts */
export type OrderStatusKpiKey =
  | "open"
  | "inProgress"
  | "completed"
  | "cancelled"
  | "debtWithdrawal";

/** האם order.status שייך לריבוע KPI (אותה לוגיקה כמו סיכום העליון) */
export function orderStatusBelongsToKpiBucket(
  orderStatus: string,
  kpiKey: OrderStatusKpiKey,
): boolean {
  switch (kpiKey) {
    case "open":
      return orderStatus === OS.OPEN;
    case "completed":
      return orderStatus === OS.COMPLETED;
    case "cancelled":
      return orderStatus === OS.CANCELLED;
    case "debtWithdrawal":
      return orderStatus === OS.DEBT_WITHDRAWAL;
    case "inProgress":
      switch (orderStatus) {
        case OS.WAITING_FOR_EXECUTION:
        case OS.WITHDRAWAL_FROM_SUPPLIER:
        case OS.SENT:
        case OS.WAITING_FOR_CHINA_EXECUTION:
          return true;
        default:
          return !isLegacyOrderStatusSlug(orderStatus);
      }
    default:
      return false;
  }
}

/** סינון מקומי לפי ריבועים פעילים (OR בין ריבועים) */
export function orderMatchesStatusKpiFilters(
  orderStatus: string,
  activeFilters: OrderStatusKpiKey[],
): boolean {
  if (activeFilters.length === 0) return true;
  return activeFilters.some((key) => orderStatusBelongsToKpiBucket(orderStatus, key));
}

export function toggleStatusKpiFilter(
  active: OrderStatusKpiKey[],
  key: OrderStatusKpiKey,
): OrderStatusKpiKey[] {
  if (active.includes(key)) return active.filter((k) => k !== key);
  return [...active, key];
}
