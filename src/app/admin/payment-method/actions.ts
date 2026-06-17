"use server";

import { fetchPaymentMethodCatalogData } from "@/lib/payment-method-registry";
import { ensurePaymentMethodSourceTable } from "@/lib/payment-method-registry-data";
import type { PaymentMethodCatalogData } from "@/lib/payment-method-shared";

export type PaymentMethodCatalog = PaymentMethodCatalogData & {
  quickOptions: PaymentMethodCatalogData["options"];
};

export async function getPaymentMethodCatalogAction(): Promise<PaymentMethodCatalog> {
  await ensurePaymentMethodSourceTable();
  const data = await fetchPaymentMethodCatalogData();
  return { ...data, quickOptions: data.options };
}
