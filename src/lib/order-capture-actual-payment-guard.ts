const ORDER_CAPTURE_ACTUAL_PAYMENT_ERROR =
  "קליטת הזמנה מגדירה רק צורת תשלום מתוכננת. לרישום תשלום בפועל השתמשו במסך קליטת תשלום.";

export type OrderCapturePlannedPaymentLine = {
  amountUsd?: string | null;
};

export function orderCaptureActualPaymentError(): string {
  return ORDER_CAPTURE_ACTUAL_PAYMENT_ERROR;
}

export function hasActualPaymentLinesInOrderCapture(
  lines: OrderCapturePlannedPaymentLine[] | undefined,
): boolean {
  return Boolean(lines?.some((line) => (line.amountUsd ?? "").trim()));
}
