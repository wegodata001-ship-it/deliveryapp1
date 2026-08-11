import {
  CASH_CONTROL_METHODS,
  CASH_CONTROL_METHOD_LABELS,
} from "@/app/admin/shipments/types";

/** אמצעי תשלום משלוחים — סדר עמודות בטבלת בקרת קופה */
export const SHIPPING_CASH_TABLE_METHODS = CASH_CONTROL_METHODS.map((m) => m.value);

export const SHIPPING_CASH_METHOD_LABELS: Record<string, string> = {
  ...CASH_CONTROL_METHOD_LABELS,
};

export const SHIPPING_METHOD_GROUP_CLASS: Record<string, string> = {
  CASH: "cc-col--method-cash",
  BANK_TRANSFER: "cc-col--method-bank",
  CREDIT_NOTE: "cc-col--method-other",
  CHECK: "cc-col--method-check",
  CREDIT: "cc-col--method-card",
  CODE_DEDUCTION: "cc-col--method-other",
};
