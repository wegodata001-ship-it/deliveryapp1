import { revalidateTag } from "next/cache";

// ─── Cache tag constants ─────────────────────────────────────────────────────
export const DASHBOARD_STATS_TAG = "wego-dashboard-stats";
export const DASHBOARD_HIGH_BALANCE_TAG = "wego-dashboard-high-balance";
export const SOURCE_TABLE_CARD_COUNTS_TAG = "wego-source-table-card-counts";
export const ORDERS_SOURCE_KPIS_TAG = "orders-source-kpis";
export const CUSTOMERS_SOURCE_KPIS_TAG_EXPORT = "customers-source-kpis";

/**
 * מבטל את כל ה-cache של KPIs — יש לקרוא אחרי כל פעולה שמשנה
 * כמויות: יצירה/עריכה/מחיקה של הזמנות, תשלומים, לקוחות.
 */
export function revalidateAllKpiCaches(): void {
  revalidateTag(DASHBOARD_STATS_TAG);
  revalidateTag(DASHBOARD_HIGH_BALANCE_TAG);
  revalidateTag(SOURCE_TABLE_CARD_COUNTS_TAG);
  revalidateTag(ORDERS_SOURCE_KPIS_TAG);
  revalidateTag(CUSTOMERS_SOURCE_KPIS_TAG_EXPORT);
}
