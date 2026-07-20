/**
 * Payment method buckets — owned by Finance Data Layer.
 * No imports from payment-breakdown-shared or other legacy modules.
 */

export type PaymentBucketKey = "CASH" | "BANK_TRANSFER" | "CREDIT" | "CHECK" | "OTHER";

export type MatchingCurrency = "USD" | "ILS";

export const PAYMENT_BUCKET_LABELS: Record<PaymentBucketKey, string> = {
  CASH: "מזומן",
  BANK_TRANSFER: "העברה בנקאית",
  CREDIT: "אשראי",
  CHECK: "צ׳יקים",
  OTHER: "אחר",
};

export function normalizePaymentMethodSlug(method: string | null | undefined): string {
  const m = (method ?? "").trim().toUpperCase();
  if (!m) return "";
  if (m === "CREDIT_CARD" || m === "CARD") return "CREDIT";
  if (m === "TRANSFER" || m === "BANK" || m === "BANK_TRANSFER_DONE") return "BANK_TRANSFER";
  if (m === "CHECKS" || m === "CHEQUE") return "CHECK";
  return m;
}

export function paymentMethodBucketKey(method: string | null | undefined): PaymentBucketKey {
  const m = normalizePaymentMethodSlug(method);
  if (m === "CASH") return "CASH";
  if (m === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (m === "CREDIT") return "CREDIT";
  if (m === "CHECK") return "CHECK";
  if (m === "OTHER") return "OTHER";
  return "OTHER";
}

export function normalizeMatchingCurrency(raw: string | null | undefined): MatchingCurrency {
  return (raw ?? "USD").toUpperCase() === "ILS" ? "ILS" : "USD";
}
