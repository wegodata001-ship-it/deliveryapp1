import { formatIlsDisplay, formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";

/** שורות תצוגה — שקלים בשורה ראשונה, דולר בסוגריים בשורה שנייה (אם קיים) */
export type LedgerAmountDisplay = {
  lines: string[];
  singleLine: string;
};

/** שורת ראשית בכרטסת — סה״כ תשלום מנורמל בדולר בלבד (SSOT) */
export function formatLedgerPaymentTotalUsd(totalUsd: string | null | undefined): string {
  const usd = parseMoneyStringOrZero(totalUsd ?? "0");
  if (usd <= 0.005) return "—";
  return formatUsdDisplay(usd);
}

/** פירוט רכיב מטבע מקורי — דולר או שקל כפי שנקלט */
export function formatLedgerPaymentComponentDisplay(
  currency: "USD" | "ILS",
  amount: string,
): string {
  const n = parseMoneyStringOrZero(amount);
  if (n <= 0.005) return "—";
  return currency === "ILS" ? formatIlsDisplay(n) : formatUsdDisplay(n);
}

export function formatLedgerAmountDisplay(
  amountIls: string | null | undefined,
  amountUsd: string,
): LedgerAmountDisplay {
  const ils = parseMoneyStringOrZero(amountIls ?? "0");
  const usd = parseMoneyStringOrZero(amountUsd);
  if (ils > 0.005) {
    const lines = [formatIlsDisplay(ils)];
    if (usd > 0.005) lines.push(`(${formatUsdDisplay(usd)})`);
    return { lines, singleLine: lines.join(" ") };
  }
  if (usd > 0.005) {
    const v = formatUsdDisplay(usd);
    return { lines: [v], singleLine: v };
  }
  return { lines: ["—"], singleLine: "—" };
}
