import { readMultiParam } from "@/lib/orders-list-filter-params";
import { isLegacyOrderStatusSlug, OS } from "@/lib/order-status-slugs";

/** מפתחות ריבועי KPI לפי status enum — תואם ל-orders-list-data.ts */
export type OrderStatusKpiKey =
  | "open"
  | "inProgress"
  | "completed"
  | "cancelled"
  | "debtWithdrawal";

/**
 * ריבוע «הושלם» אינו status enum — זה דגל isCompleted.
 * ordersKpi שומר את בחירת הריבועים ב-URL בלי לדרוס את status= של מסנן «סטטוס הזמנה».
 */
export type OrdersKpiFilterKey = OrderStatusKpiKey | "operationalCompleted";

export const ORDERS_KPI_PARAM = "ordersKpi";

export const ORDERS_KPI_FILTER_KEYS = [
  "open",
  "inProgress",
  "completed",
  "operationalCompleted",
  "debtWithdrawal",
  "cancelled",
] as const satisfies readonly OrdersKpiFilterKey[];

const KPI_LABELS: Record<OrdersKpiFilterKey, string> = {
  open: "פתוחה",
  inProgress: "ממתין לביצוע",
  completed: "בוצע",
  operationalCompleted: "הושלם",
  debtWithdrawal: "משיכה מחו״ב",
  cancelled: "מבוטל",
};

export function isOrdersKpiFilterKey(value: string): value is OrdersKpiFilterKey {
  return (ORDERS_KPI_FILTER_KEYS as readonly string[]).includes(value);
}

export function ordersKpiLabel(key: OrdersKpiFilterKey): string {
  return KPI_LABELS[key];
}

export function parseOrdersKpiFilters(
  sp: Record<string, string | string[] | undefined> | Pick<URLSearchParams, "get">,
): OrdersKpiFilterKey[] {
  const raw =
    typeof (sp as URLSearchParams).get === "function"
      ? (sp as URLSearchParams).get(ORDERS_KPI_PARAM) ?? undefined
      : (sp as Record<string, string | string[] | undefined>)[ORDERS_KPI_PARAM];
  return readMultiParam({ [ORDERS_KPI_PARAM]: raw }, ORDERS_KPI_PARAM).filter(isOrdersKpiFilterKey);
}

export function serializeOrdersKpiFilters(keys: OrdersKpiFilterKey[]): string {
  return [...new Set(keys.filter(isOrdersKpiFilterKey))].join(",");
}

/** בוצע = COMPLETED שעדיין לא סומן הושלם. הושלם = isCompleted. */
export function orderMatchesCompletedKpi(order: { status: string; isCompleted?: boolean }): boolean {
  return order.status === OS.COMPLETED && !order.isCompleted;
}

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

export function orderMatchesOrdersKpiFilters(
  order: { status: string; isCompleted?: boolean },
  activeFilters: OrdersKpiFilterKey[],
): boolean {
  if (activeFilters.length === 0) return true;
  return activeFilters.some((key) => {
    if (key === "operationalCompleted") return Boolean(order.isCompleted);
    if (key === "completed") return orderMatchesCompletedKpi(order);
    return orderStatusBelongsToKpiBucket(order.status, key);
  });
}

/** סינון מקומי לפי ריבועי status בלבד (OR) */
export function orderMatchesStatusKpiFilters(
  orderStatus: string,
  activeFilters: OrderStatusKpiKey[],
): boolean {
  return orderMatchesOrdersKpiFilters({ status: orderStatus }, activeFilters);
}

export function toggleOrdersKpiFilter(
  active: OrdersKpiFilterKey[],
  key: OrdersKpiFilterKey,
): OrdersKpiFilterKey[] {
  if (active.includes(key)) return active.filter((k) => k !== key);
  return [...active, key];
}

export function toggleStatusKpiFilter(
  active: OrderStatusKpiKey[],
  key: OrderStatusKpiKey,
): OrderStatusKpiKey[] {
  return toggleOrdersKpiFilter(active, key) as OrderStatusKpiKey[];
}
