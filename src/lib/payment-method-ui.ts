/**
 * מקור אמת יחיד לצבעי אמצעי תשלום — טבלאות, KPI, מודלים, דוחות.
 * ירוק=מזומן · כחול=העברה · כתום=זיכוי · סגול=צ'קים · טורקיז=אשראי · אדום=משיכה מהקוד
 */

export type PaymentMethodUiKey =
  | "cash"
  | "bankTransfer"
  | "credit"
  | "checks"
  | "card"
  | "codeWithdrawal"
  | "other";

export type PaymentMethodColorSet = {
  bg: string;
  border: string;
  text: string;
};

export const PAYMENT_METHOD_COLORS: Record<PaymentMethodUiKey, PaymentMethodColorSet> = {
  cash: {
    bg: "#ECFDF5",
    border: "#86EFAC",
    text: "#15803D",
  },
  bankTransfer: {
    bg: "#EFF6FF",
    border: "#93C5FD",
    text: "#1D4ED8",
  },
  credit: {
    bg: "#FFF7ED",
    border: "#FDBA74",
    text: "#C2410C",
  },
  checks: {
    bg: "#FAF5FF",
    border: "#D8B4FE",
    text: "#7E22CE",
  },
  card: {
    bg: "#F0FDFA",
    border: "#5EEAD4",
    text: "#0F766E",
  },
  codeWithdrawal: {
    bg: "#FFF1F2",
    border: "#FDA4AF",
    text: "#BE123C",
  },
  other: {
    bg: "#F8FAFC",
    border: "#CBD5E1",
    text: "#475569",
  },
};

const UI_KEY_LABELS: Record<PaymentMethodUiKey, string> = {
  cash: "מזומן",
  bankTransfer: "העברה בנקאית",
  credit: "זיכוי",
  checks: "צ'קים",
  card: "אשראי",
  codeWithdrawal: "משיכה מהקוד",
  other: "אחר",
};

const PM_CSS_CLASS: Record<PaymentMethodUiKey, string> = {
  cash: "cc-col--pm-cash",
  bankTransfer: "cc-col--pm-bank-transfer",
  credit: "cc-col--pm-credit",
  checks: "cc-col--pm-checks",
  card: "cc-col--pm-card",
  codeWithdrawal: "cc-col--pm-code-withdrawal",
  other: "cc-col--pm-other",
};

export type PaymentMethodUi = {
  key: PaymentMethodUiKey;
  label: string;
  background: string;
  border: string;
  textColor: string;
  cssClass: string;
};

/** ממפה מזהה אמצעי תשלום / ערוץ בקרת קופה למפתח UI קנוני */
export function resolvePaymentMethodUiKey(method: string | null | undefined): PaymentMethodUiKey {
  const m = String(method ?? "").trim().toUpperCase();
  if (!m) return "other";

  if (m === "CASH" || m.startsWith("CASH_")) return "cash";
  if (m === "BANK_TRANSFER" || m.startsWith("BANK_TRANSFER")) return "bankTransfer";
  if (m === "CREDIT_NOTE" || m === "CREDITNOTE") return "credit";
  if (m === "CHECK" || m === "CHECKS" || m.startsWith("CHECK")) return "checks";
  if (m === "CREDIT" || m === "CREDIT_CARD" || m === "CARD" || m.startsWith("CREDIT_CARD")) {
    return "card";
  }
  if (m === "CODE_DEDUCTION" || m === "CODE_WITHDRAWAL" || m === "CODE_DEDUCT") {
    return "codeWithdrawal";
  }

  return "other";
}

export function getPaymentMethodUI(
  method: string | null | undefined,
  labelOverride?: string | null,
): PaymentMethodUi {
  const key = resolvePaymentMethodUiKey(method);
  const colors = PAYMENT_METHOD_COLORS[key];
  return {
    key,
    label: labelOverride?.trim() || UI_KEY_LABELS[key],
    background: colors.bg,
    border: colors.border,
    textColor: colors.text,
    cssClass: PM_CSS_CLASS[key],
  };
}

export function paymentMethodColumnClass(method: string | null | undefined): string {
  return getPaymentMethodUI(method).cssClass;
}
