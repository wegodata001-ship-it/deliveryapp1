/**
 * סטטוס תשלום להזמנה — מבוסס Ledger (totalUsd − paidUsd).
 * ערכים תואמים ל־deriveOrderPaymentDisplayStatus + overpaid ליתרת זכות.
 */

export const ORDER_PAYMENT_STATUS_FILTER_VALUES = [
  "unpaid",
  "partial",
  "paid",
  "overpaid",
] as const;

export type OrderPaymentStatusFilterValue = (typeof ORDER_PAYMENT_STATUS_FILTER_VALUES)[number];

export const ORDER_PAYMENT_STATUS_FILTER_OPTIONS: Array<{
  value: OrderPaymentStatusFilterValue;
  label: string;
}> = [
  { value: "unpaid", label: "לא שולם" },
  { value: "partial", label: "שולם חלקית" },
  { value: "paid", label: "שולם" },
  { value: "overpaid", label: "תשלום יתר" },
];

export function isOrderPaymentStatusFilterValue(
  raw: string | null | undefined,
): raw is OrderPaymentStatusFilterValue {
  return ORDER_PAYMENT_STATUS_FILTER_VALUES.includes(
    (raw || "").trim() as OrderPaymentStatusFilterValue,
  );
}

export function orderPaymentStatusFilterLabel(value: string): string {
  return ORDER_PAYMENT_STATUS_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** סיווג לפי יתרה חתומה (openDebt = total − paid) */
export function classifyOrderPaymentStatusFilter(params: {
  totalUsd: number;
  paidUsd: number;
  eps?: number;
}): OrderPaymentStatusFilterValue {
  const eps = params.eps ?? 0.02;
  const total = Number.isFinite(params.totalUsd) ? params.totalUsd : 0;
  const paid = Number.isFinite(params.paidUsd) ? params.paidUsd : 0;
  const open = Math.round((total - paid) * 100) / 100;
  if (open < -eps) return "overpaid";
  if (open <= eps) return "paid";
  if (paid <= eps) return "unpaid";
  return "partial";
}
