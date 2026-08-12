import {
  CASH_CONTROL_METHODS,
  CASH_CONTROL_METHOD_LABELS,
} from "@/app/admin/shipments/types";
import { getPaymentMethodUI } from "@/lib/payment-method-ui";

/** אמצעי תשלום משלוחים — סדר עמודות בטבלת בקרת קופה */
export const SHIPPING_CASH_TABLE_METHODS = CASH_CONTROL_METHODS.map((m) => m.value);

export const SHIPPING_CASH_METHOD_LABELS: Record<string, string> = {
  ...CASH_CONTROL_METHOD_LABELS,
};

export const SHIPPING_METHOD_GROUP_CLASS: Record<string, string> = Object.fromEntries(
  SHIPPING_CASH_TABLE_METHODS.map((method) => [method, getPaymentMethodUI(method).cssClass]),
);
