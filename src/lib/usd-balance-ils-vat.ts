/**
 * Display conversion: USD customer balance → ILS including VAT.
 *
 * ILS_NET           = USD × rate
 * VAT               = ILS_NET × VAT_RATE
 * ILS_GROSS_WITH_VAT = USD × rate × VAT_GROSS_FACTOR
 *
 * USD SSOT is never changed here. Do not use this on native ILS amounts
 * that already include VAT (order totalIlsWithVat, payment ILS lines).
 */

import { VAT_GROSS_FACTOR, VAT_RATE } from "@/lib/vat";
import { roundMoney2 } from "@/lib/finance-data/types/money";
import { formatIlsDisplay } from "@/lib/money-format";

export const ILS_NET = "ILS_NET" as const;
export const ILS_GROSS_WITH_VAT = "ILS_GROSS_WITH_VAT" as const;
export type IlsVatKind = typeof ILS_NET | typeof ILS_GROSS_WITH_VAT;

export type UsdBalanceIlsVatBreakdown = {
  usd: number;
  exchangeRate: number;
  /** ILS_NET — before VAT */
  ilsNet: number;
  vatIls: number;
  /** ILS_GROSS_WITH_VAT — display amount */
  ilsGrossWithVat: number;
  kind: typeof ILS_GROSS_WITH_VAT;
};

function finiteNumber(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** ILS before VAT. Round only at the end. */
export function convertUsdToIlsNet(usd: number, exchangeRate: number): number {
  const amount = finiteNumber(usd);
  const rate = finiteNumber(exchangeRate);
  if (rate <= 0) return 0;
  return roundMoney2(amount * rate);
}

/** ILS including VAT. Single SSOT for debt/credit USD → ₪ display. */
export function convertDebtUsdToIlsIncludingVat(debtUsd: number, exchangeRate: number): number {
  const amount = finiteNumber(debtUsd);
  const rate = finiteNumber(exchangeRate);
  if (rate <= 0) return 0;
  return roundMoney2(amount * rate * VAT_GROSS_FACTOR);
}

export function convertUsdBalanceToIlsVat(
  usd: number,
  exchangeRate: number,
): UsdBalanceIlsVatBreakdown {
  const amount = roundMoney2(finiteNumber(usd));
  const rate = finiteNumber(exchangeRate);
  const ilsNet = convertUsdToIlsNet(amount, rate);
  const ilsGrossWithVat = convertDebtUsdToIlsIncludingVat(amount, rate);
  return {
    usd: amount,
    exchangeRate: rate,
    ilsNet,
    vatIls: roundMoney2(ilsGrossWithVat - ilsNet),
    ilsGrossWithVat,
    kind: ILS_GROSS_WITH_VAT,
  };
}

export function formatIlsGrossWithVatDisplay(ilsGrossWithVat: number): string {
  return `${formatIlsDisplay(ilsGrossWithVat)} כולל מע״מ`;
}

export { VAT_GROSS_FACTOR, VAT_RATE };
