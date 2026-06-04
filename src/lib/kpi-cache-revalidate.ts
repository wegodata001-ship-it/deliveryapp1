import { revalidateTag } from "next/cache";
import {
  CUSTOMERS_SOURCE_KPIS_TAG_EXPORT,
  DASHBOARD_HIGH_BALANCE_TAG,
  DASHBOARD_STATS_TAG,
  ORDERS_SOURCE_KPIS_TAG,
  SOURCE_TABLE_CARD_COUNTS_TAG,
} from "@/lib/kpi-cache-tags";

/** Server-only — אל תייבא מרכיבי client */
export function revalidateAllKpiCaches(): void {
  revalidateTag(DASHBOARD_STATS_TAG);
  revalidateTag(DASHBOARD_HIGH_BALANCE_TAG);
  revalidateTag(SOURCE_TABLE_CARD_COUNTS_TAG);
  revalidateTag(ORDERS_SOURCE_KPIS_TAG);
  revalidateTag(CUSTOMERS_SOURCE_KPIS_TAG_EXPORT);
}
