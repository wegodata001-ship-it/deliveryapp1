"use server";

import {
  buildEditSelectOptions,
  buildQuickSelectOptions,
  getOrderStatusLabelMap,
  listOrderStatusSourceRows,
} from "@/lib/order-status-registry";

export type OrderStatusCatalog = {
  labelById: Record<string, string>;
  quickOptions: Array<{ value: string; label: string }>;
  editOptions: Array<{ value: string; label: string }>;
};

export async function getOrderStatusCatalogAction(): Promise<OrderStatusCatalog> {
  const rows = await listOrderStatusSourceRows();
  const labelById = await getOrderStatusLabelMap();
  return {
    labelById,
    quickOptions: buildQuickSelectOptions(rows).map((o) => ({ value: o.value, label: o.label })),
    editOptions: buildEditSelectOptions(rows).map((o) => ({ value: o.value, label: o.label })),
  };
}
