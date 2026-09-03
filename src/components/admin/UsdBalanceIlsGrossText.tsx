"use client";

import {
  convertDebtUsdToIlsIncludingVat,
  formatIlsGrossWithVatDisplay,
} from "@/lib/usd-balance-ils-vat";

type Props = {
  usd: number;
  exchangeRate: number;
  className?: string;
};

/** Display-only: ₪ GROSS WITH VAT under a USD balance. */
export function UsdBalanceIlsGrossText({ usd, exchangeRate, className }: Props) {
  if (!(exchangeRate > 0) || !Number.isFinite(usd) || Math.abs(usd) <= 0.005) return null;
  const ils = convertDebtUsdToIlsIncludingVat(Math.abs(usd), exchangeRate);
  if (ils <= 0.005) return null;
  return (
    <span className={className} dir="ltr">
      {formatIlsGrossWithVatDisplay(ils)}
    </span>
  );
}
