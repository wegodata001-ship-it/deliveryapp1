import type { OrderEditDiffRow, OrderEditSnapshot } from "@/lib/order-edit-snapshot";

/** שדות שדורשים אישור מנהל לפני עדכון הזמנה קיימת */
export const SENSITIVE_ORDER_EDIT_FIELDS: ReadonlySet<keyof OrderEditSnapshot> = new Set([
  "amountUsd",
  "feeUsd",
  "commissionPercent",
  "customerLabel",
  "customerCode",
  "weekCode",
  "sourceCountry",
  "paymentMethod",
  "notes",
  "locationName",
]);

export function isSensitiveOrderEditField(key: keyof OrderEditSnapshot): boolean {
  return SENSITIVE_ORDER_EDIT_FIELDS.has(key);
}

export function filterSensitiveOrderEditDiff(diff: OrderEditDiffRow[]): OrderEditDiffRow[] {
  return diff.filter((row) => isSensitiveOrderEditField(row.key));
}

export function orderEditDiffRequiresApproval(diff: OrderEditDiffRow[]): boolean {
  return filterSensitiveOrderEditDiff(diff).length > 0;
}
