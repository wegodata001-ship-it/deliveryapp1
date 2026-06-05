"use server";

import { unstable_noStore as noStore } from "next/cache";
import { fetchOrdersListPageData } from "@/lib/orders-list-data";
import { requireRoutePermission } from "@/lib/route-access";

/** רענון רשימת הזמנות לפי פרמטרי URL נוכחיים — ללא שינוי פילטרים */
export async function refreshOrdersListAction(
  sp: Record<string, string | string[] | undefined>,
) {
  noStore();
  const me = await requireRoutePermission(["view_orders"]);
  return fetchOrdersListPageData(sp, me);
}
