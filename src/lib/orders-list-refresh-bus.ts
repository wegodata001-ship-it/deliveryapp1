export const WEGO_ORDERS_LIST_REFRESH_EVENT = "wego:orders-list-refresh";

export type OrdersListRefreshDetail = {
  orderId?: string | null;
  orderNumber?: string | null;
};

/** מודיע למסך רשימת הזמנות לרענון אחרי יצירה/עריכה/תשלום */
export function dispatchOrdersListRefresh(detail: OrdersListRefreshDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OrdersListRefreshDetail>(WEGO_ORDERS_LIST_REFRESH_EVENT, { detail }),
  );
}
