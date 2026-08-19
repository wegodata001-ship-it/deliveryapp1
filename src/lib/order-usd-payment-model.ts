/**
 * USD-only order model — Source of Truth for order debt and payment conversion.
 *
 * Order debt is always USD: totalUsd − Σ Payment.amountUsd (see computeOpenDebtUsd).
 * ILS is payment currency only — converted to USD at payment time using a rate snapshot.
 */

import { previewOrderIlsSummary } from "@/lib/order-capture-preview";
import { roundMoney2 } from "@/lib/payment-updated";
import { computeOpenDebtUsd } from "@/lib/order-remaining-debt";
import { VAT_RATE_PERCENT } from "@/lib/vat";

export type PaymentInputCurrency = "USD" | "ILS";

export type PaymentConversionSnapshot = {
  originalAmount: number;
  currency: PaymentInputCurrency;
  exchangeRate: number;
  amountUsd: number;
};

/** Full order + ILS conversion breakdown for capture UI (USD is SSOT). */
export type OrderCaptureMoneyBreakdown = {
  dealUsd: number;
  commissionUsd: number;
  commissionPct: number;
  totalUsd: number;
  vatUsd: number;
  rate: number;
  vatPercent: number;
  dealIls: number;
  commissionIls: number;
  afterCommissionIls: number;
  beforeVatIls: number;
  vatIls: number;
  totalWithVatIls: number;
  paidUsd: number;
  paidIls: number;
  remainingUsd: number;
  remainingIls: number;
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

/** ILS equivalent display for a USD amount (informational only). */
export function usdBalanceToIlsDisplay(usdAmount: number, exchangeRate: number): number {
  const usd = Number(usdAmount);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return roundMoney2(usd * rate);
}

/**
 * Order capture breakdown: USD SSOT → ILS via rate × component.
 * VAT uses previewOrderIlsSummary (same as server financial-calc).
 */
export function computeOrderCaptureMoneyBreakdown(input: {
  dealUsd: number;
  commissionUsd: number;
  commissionPct: number;
  rate: number;
  paidUsd?: number;
  remainingUsd?: number;
  vatPercent?: number;
}): OrderCaptureMoneyBreakdown | null {
  const dealUsd = roundMoney2(input.dealUsd);
  const commissionUsd = roundMoney2(input.commissionUsd);
  const rate = Number(input.rate);
  const vatPercent = input.vatPercent ?? VAT_RATE_PERCENT;
  if (dealUsd <= 0 || rate <= 0) return null;

  const totalUsd = roundMoney2(dealUsd + commissionUsd);
  const preview = previewOrderIlsSummary(dealUsd, commissionUsd, rate, vatPercent);
  if (!preview) return null;

  const paidUsd = roundMoney2(input.paidUsd ?? 0);
  const remainingUsd =
    input.remainingUsd != null
      ? roundMoney2(Math.max(0, input.remainingUsd))
      : roundMoney2(Math.max(0, totalUsd - paidUsd));

  const dealIls = usdBalanceToIlsDisplay(dealUsd, rate);
  const commissionIls = usdBalanceToIlsDisplay(commissionUsd, rate);
  const afterCommissionIls = usdBalanceToIlsDisplay(totalUsd, rate);
  const vatIls = preview.vatAmount;
  const vatUsd = rate > 0 ? roundMoney2(vatIls / rate) : 0;

  return {
    dealUsd,
    commissionUsd,
    commissionPct: input.commissionPct,
    totalUsd,
    vatUsd,
    rate,
    vatPercent,
    dealIls,
    commissionIls,
    afterCommissionIls,
    beforeVatIls: preview.totalIlsWithoutVat,
    vatIls,
    totalWithVatIls: preview.totalIlsWithVat,
    paidUsd,
    paidIls: usdBalanceToIlsDisplay(paidUsd, rate),
    remainingUsd,
    remainingIls: usdBalanceToIlsDisplay(remainingUsd, rate),
  };
}
