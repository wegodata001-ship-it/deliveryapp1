/** תוויות וטון אמצעי תשלום — בטוח לייבוא מ-client (ללא prisma / server-only) */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  POINT: "נקודת תשלום",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  WITH_GOODS: "עם הסחורה",
  CHECK: "צ׳ק",
  CASH: "מזומן",
  CREDIT: "אשראי",
  OTHER: "אחר",
};

export type PaymentMethodTone = "cash" | "bank" | "credit" | "check" | "neutral";

export type PaymentsSourcePreview = {
  customerCode: string;
  customerName: string;
  phone: string;
  lastPaymentLabel: string;
  ordersCount: number;
};

export function paymentMethodTone(method: string | null | undefined): PaymentMethodTone {
  if (!method) return "neutral";
  if (method === "CASH") return "cash";
  if (method === "BANK_TRANSFER" || method === "BANK_TRANSFER_DONE") return "bank";
  if (method === "CREDIT") return "credit";
  if (method === "CHECK") return "check";
  return "neutral";
}
