// מקור אמת יחיד לצבעים וללייבלים של אמצעי תשלום — אחידות בכל המערכת:
// קליטת תשלום, כרטסת, דוחות PDF/Excel, דוח יתרות, דוח תשלומים.
// STEP 4: מזומן=ירוק · אשראי=סגול · העברה בנקאית=כחול · צ'קים=כתום · אחר=אפור.

export type PaymentMethodStyleKey = "cash" | "credit" | "bank_transfer" | "checks" | "other";

export type PaymentMethodStyle = {
  key: PaymentMethodStyleKey;
  label: string;
  /** צבע ראשי (טקסט/מסגרת חזקה) */
  color: string;
  /** רקע עדין */
  bg: string;
  /** מסגרת */
  border: string;
};

export const PAYMENT_METHOD_STYLES: Record<PaymentMethodStyleKey, PaymentMethodStyle> = {
  cash: { key: "cash", label: "מזומן", color: "#15803d", bg: "#dcfce7", border: "#86efac" },
  credit: { key: "credit", label: "אשראי", color: "#6d28d9", bg: "#ede9fe", border: "#c4b5fd" },
  bank_transfer: { key: "bank_transfer", label: "העברה בנקאית", color: "#0369a1", bg: "#e0f2fe", border: "#7dd3fc" },
  checks: { key: "checks", label: "צ'קים", color: "#c2410c", bg: "#ffedd5", border: "#fdba74" },
  other: { key: "other", label: "אחר", color: "#475569", bg: "#f1f5f9", border: "#cbd5e1" },
};

/** ממפה מזהה אמצעי תשלום (DB/טופס) למפתח סגנון קנוני */
export function paymentMethodStyleKey(method: string | null | undefined): PaymentMethodStyleKey {
  const m = String(method ?? "").trim().toUpperCase();
  switch (m) {
    case "CASH":
      return "cash";
    case "CREDIT":
    case "CREDIT_CARD":
      return "credit";
    case "BANK_TRANSFER":
    case "TRANSFER":
      return "bank_transfer";
    case "CHECK":
    case "CHECKS":
      return "checks";
    default:
      return "other";
  }
}

export function paymentMethodStyle(method: string | null | undefined): PaymentMethodStyle {
  return PAYMENT_METHOD_STYLES[paymentMethodStyleKey(method)];
}
