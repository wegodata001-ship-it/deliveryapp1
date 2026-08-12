// מקור אמת יחיד לצבעים וללייבלים של אמצעי תשלום — אחידות בכל המערכת.
// מימוש: payment-method-ui.ts

import {
  getPaymentMethodUI,
  PAYMENT_METHOD_COLORS,
  resolvePaymentMethodUiKey,
  type PaymentMethodUiKey,
} from "@/lib/payment-method-ui";

export type PaymentMethodStyleKey = PaymentMethodUiKey;

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

const STYLE_KEY_LABELS: Record<PaymentMethodStyleKey, string> = {
  cash: "מזומן",
  bankTransfer: "העברה בנקאית",
  credit: "זיכוי",
  checks: "צ'קים",
  card: "אשראי",
  codeWithdrawal: "משיכה מהקוד",
  other: "אחר",
};

/** @deprecated השתמשו ב-PAYMENT_METHOD_COLORS מ-payment-method-ui */
export const PAYMENT_METHOD_STYLES: Record<PaymentMethodStyleKey, PaymentMethodStyle> =
  Object.fromEntries(
    (Object.keys(PAYMENT_METHOD_COLORS) as PaymentMethodUiKey[]).map((key) => {
      const colors = PAYMENT_METHOD_COLORS[key];
      return [
        key,
        {
          key,
          label: STYLE_KEY_LABELS[key],
          color: colors.text,
          bg: colors.bg,
          border: colors.border,
        },
      ];
    }),
  ) as Record<PaymentMethodStyleKey, PaymentMethodStyle>;

/** ממפה מזהה אמצעי תשלום (DB/טופס) למפתח סגנון קנוני */
export function paymentMethodStyleKey(method: string | null | undefined): PaymentMethodStyleKey {
  return resolvePaymentMethodUiKey(method);
}

export function paymentMethodStyle(method: string | null | undefined): PaymentMethodStyle {
  const ui = getPaymentMethodUI(method);
  return {
    key: ui.key,
    label: ui.label,
    color: ui.textColor,
    bg: ui.background,
    border: ui.border,
  };
}

export { getPaymentMethodUI, resolvePaymentMethodUiKey } from "@/lib/payment-method-ui";
