/**
 * USD-only order model — Source of Truth for order debt and payment conversion.
 *
 * Order debt is always USD: totalUsd − Σ Payment.amountUsd (see computeOpenDebtUsd).
 * ILS is payment currency only — converted to USD at payment time using a rate snapshot.
 */

import { roundMoney2 } from "@/lib/payment-updated";
import { computeOpenDebtUsd } from "@/lib/order-remaining-debt";

export type PaymentInputCurrency = "USD" | "ILS";

export type PaymentConversionSnapshot = {
  originalAmount: number;
  currency: PaymentInputCurrency;
  exchangeRate: number;
  amountUsd: number;
};

/** Re-export ledger SSOT for order remaining / paid / open debt. */
export { computeOpenDebtUsd };

/** Convert ILS payment input to USD ledger credit using frozen rate. */
export function convertIlsPaymentToUsdCredit(ilsAmount: number, exchangeRate: number): number {
  const ils = Number(ilsAmount);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(ils) || ils <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return roundMoney2(ils / rate);
}

/** USD payment — ledger credit equals input. */
export function convertUsdPaymentToUsdCredit(usdAmount: number): number {
  const usd = Number(usdAmount);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return roundMoney2(usd);
}

/** Convert payment input (USD or ILS) to USD ledger credit. */
export function convertPaymentInputToUsdCredit(
  amount: number,
  currency: PaymentInputCurrency,
  exchangeRate: number,
): PaymentConversionSnapshot {
  const originalAmount = roundMoney2(amount);
  if (currency === "ILS") {
    const rate = roundMoney2(exchangeRate);
    return {
      originalAmount,
      currency: "ILS",
      exchangeRate: rate,
      amountUsd: convertIlsPaymentToUsdCredit(originalAmount, rate),
    };
  }
  return {
    originalAmount,
    currency: "USD",
    exchangeRate: roundMoney2(exchangeRate),
    amountUsd: convertUsdPaymentToUsdCredit(originalAmount),
  };
}

/** ILS equivalent display for an open USD balance (informational only). */
export function usdBalanceToIlsDisplay(usdAmount: number, exchangeRate: number): number {
  const usd = Number(usdAmount);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return roundMoney2(usd * rate);
}
