import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import type { SerializedFinancial } from "@/lib/financial-settings.shared";

export type CaptureFinancialSnapshotInput = {
  baseDollarRate: string;
  dollarFee: string;
  finalDollarRate: string;
};

export type CaptureCustomerSnapshotInput = {
  id: string;
  customerCode: string | null;
  displayName: string;
  customerType: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
};

/** בונה snapshot מהמסך — תמיד לפני POST capture (גם כש-financial prop חלקי) */
export function buildCaptureFinancialSnapshot(
  financial: SerializedFinancial | null,
  displayFinalRate: number,
): CaptureFinancialSnapshotInput {
  const base = financial?.baseDollarRate?.trim();
  const fee = financial?.dollarFee?.trim();
  const final = financial?.finalDollarRate?.trim();
  if (base && fee && final) {
    return { baseDollarRate: base, dollarFee: fee, finalDollarRate: final };
  }
  const rate =
    Number.isFinite(displayFinalRate) && displayFinalRate > 0 ? displayFinalRate : 3.5;
  const rateStr = rate.toFixed(4);
  return {
    baseDollarRate: base || rateStr,
    dollarFee: fee || "0",
    finalDollarRate: final || rateStr,
  };
}

export function parseEnabledCountriesFromForm(
  raw: string[] | null | undefined,
): OrderCountryCode[] | null {
  if (!raw?.length) return null;
  const allowed = new Set<string>(ORDER_COUNTRY_CODES);
  const list = raw.filter((c): c is OrderCountryCode => allowed.has(c));
  return list.length > 0 ? list : null;
}
