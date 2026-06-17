"use client";

import { formatLedgerAmountDisplay } from "@/lib/ledger-payment-display";

type Props = {
  amountIls: string | null | undefined;
  amountUsd: string;
  className?: string;
};

/** תצוגת סכום בכרטסת — ₪ מקורי + ($ דולר) */
export function LedgerDualAmountDisplay({ amountIls, amountUsd, className }: Props) {
  const disp = formatLedgerAmountDisplay(amountIls, amountUsd);
  return (
    <span className={className ?? "adm-ledger-dual-amt"} dir="ltr">
      {disp.lines.map((line, i) => (
        <span key={i} className={i === 1 ? "adm-ledger-dual-amt__usd" : "adm-ledger-dual-amt__primary"}>
          {line}
        </span>
      ))}
    </span>
  );
}

export function ledgerPaymentCellDisplay(
  paymentUsd: string,
  detail?: { totalIls: string | null; totalUsd: string } | null,
): { lines: string[] } {
  if (detail) {
    return formatLedgerAmountDisplay(detail.totalIls, detail.totalUsd);
  }
  return formatLedgerAmountDisplay(null, paymentUsd);
}
