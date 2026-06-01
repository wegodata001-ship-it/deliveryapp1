import type { ClientCreateResult } from "@/app/admin/customers/ledger-types";
import { invalidateCustomerSearchClientCache } from "@/lib/customer-search-client";

export const WEGO_CUSTOMER_CREATED_EVENT = "wego:customer-created";

export type CustomerCreatedDetail = ClientCreateResult;

/** Notify open UI (כרטסת, טבלת לקוחות מקור) לרענון בלי refresh ידני */
export function dispatchCustomerCreated(client: CustomerCreatedDetail): void {
  if (typeof window === "undefined") return;
  invalidateCustomerSearchClientCache();
  window.dispatchEvent(new CustomEvent<CustomerCreatedDetail>(WEGO_CUSTOMER_CREATED_EVENT, { detail: client }));
}
