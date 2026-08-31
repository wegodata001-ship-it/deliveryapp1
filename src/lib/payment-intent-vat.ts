import type { PaymentBalanceCurrency } from "@/lib/payment-method-captured-balances";

export const PAYMENT_INTENT_ILS_VAT_RATE = 0.18;

function roundMoney2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type PaymentIntentDeduction = {
  currency: PaymentBalanceCurrency;
  /** הסכום שהלקוח מוסר — כולל מע"מ כשמדובר ב-ILS */
  grossNative: number;
  /** מע"מ שנוטרל; תמיד 0 עבור USD */
  vatIls: number;
  /** סכום לפני מע"מ ב-ILS; זהה ל-grossNative עבור USD */
  netNative: number;
  /** הסכום שמותר לקזז מחוב הלקוח */
  amountUsd: number | null;
};

/** מוציא 18% מע"מ מתוך מחיר ILS הכולל מע"מ: gross / 1.18. */
export function extractIncludedVatIls(grossIlsRaw: number): {
  grossIls: number;
  netIls: number;
  vatIls: number;
} {
  const grossIls = roundMoney2(Math.max(0, Number(grossIlsRaw) || 0));
  const netIls = roundMoney2(grossIls / (1 + PAYMENT_INTENT_ILS_VAT_RATE));
  const vatIls = roundMoney2(grossIls - netIls);
  return { grossIls, netIls, vatIls };
}

/**
 * SSOT לחישוב הסכום לקיזוז בהתאמה אוטומטית.
 * ILS: נטרול מע"מ מהסכום הכולל, ורק אז המרה לדולר.
 * USD: ללא נטרול מע"מ.
 */
export function calculatePaymentIntentDeduction(params: {
  amountNative: number;
  currency: PaymentBalanceCurrency;
  exchangeRate?: number | null;
}): PaymentIntentDeduction {
  const currency: PaymentBalanceCurrency = params.currency === "ILS" ? "ILS" : "USD";
  const grossNative = roundMoney2(Math.max(0, Number(params.amountNative) || 0));

  if (currency === "USD") {
    return {
      currency,
      grossNative,
      vatIls: 0,
      netNative: grossNative,
      amountUsd: grossNative,
    };
  }

  const { netIls, vatIls } = extractIncludedVatIls(grossNative);
  const rate = Number(params.exchangeRate);
  return {
    currency,
    grossNative,
    vatIls,
    netNative: netIls,
    amountUsd: Number.isFinite(rate) && rate > 0 ? roundMoney2(netIls / rate) : null,
  };
}
