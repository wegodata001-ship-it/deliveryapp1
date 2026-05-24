"use server";

import {
  fetchOrderStatusCatalogData,
  type OrderStatusSelectOption,
  type OrderStatusTag,
} from "@/lib/order-status-registry";

export type OrderStatusCatalog = {
  statuses: OrderStatusTag[];
  labelById: Record<string, string>;
  options: OrderStatusSelectOption[];
  /** @deprecated use options */
  quickOptions: OrderStatusSelectOption[];
  /** @deprecated use options */
  editOptions: OrderStatusSelectOption[];
};

export async function getOrderStatusCatalogAction(): Promise<OrderStatusCatalog> {
  const data = await fetchOrderStatusCatalogData();
  return {
    ...data,
    quickOptions: data.options,
    editOptions: data.options,
  };
}
