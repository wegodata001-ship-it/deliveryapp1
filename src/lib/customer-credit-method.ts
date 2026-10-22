import { roundOrderMoney2 } from "@/lib/order-remaining-debt";

const EPS = 0.01;

export type CreditSurplusMethodSlice = {
  method: string;
  label: string;
  amountUsd: number;
  currency?: "USD" | "ILS";
};

/**
 * שומר את אמצעי התשלום שכבר חושב כעודף — בלי לשנות סדר הקצאה.
 * אם הפירוט הקיים לא מסתכם לעודף, נופלים לשורה אחת עם אמצעי הטופס.
 */
export function creditSurplusSlicesFromExistingAllocation(input: {
  unallocatedUsd: number;
  excessByMethod: Array<{ method: string; label: string; excessUsd: number; currency?: "USD" | "ILS" }>;
  fallbackMethod: string;
  fallbackLabel: string;
}): CreditSurplusMethodSlice[] {
  const total = roundOrderMoney2(Math.max(0, input.unallocatedUsd));
  if (total <= EPS) return [];
  const slices = input.excessByMethod
    .map((row) => ({
      method: String(row.method || "").trim(),
      label: String(row.label || row.method || "").trim(),
      amountUsd: roundOrderMoney2(Math.max(0, row.excessUsd)),
      currency: row.currency,
    }))
    .filter((row) => row.method && row.amountUsd > EPS);
  const sum = roundOrderMoney2(slices.reduce((s, row) => s + row.amountUsd, 0));
  if (slices.length > 0 && Math.abs(sum - total) <= EPS) {
    return slices;
  }
  if (slices.length === 1) {
    return [{ ...slices[0]!, amountUsd: total }];
  }
  return [
    {
      method: String(input.fallbackMethod || "OTHER").trim() || "OTHER",
      label: String(input.fallbackLabel || input.fallbackMethod || "OTHER").trim() || "OTHER",
      amountUsd: total,
    },
  ];
}
