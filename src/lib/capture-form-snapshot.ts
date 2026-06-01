import { Prisma } from "@prisma/client";
import { ORDER_COUNTRY_CODES, type OrderCountryCode } from "@/lib/order-countries";
import type { SerializedFinancial } from "@/lib/financial-settings";

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

export type CaptureFinancialResolved = {
  base: Prisma.Decimal;
  fee: Prisma.Decimal;
  final: Prisma.Decimal;
};

function parsePositiveDecimal(raw: string, label: string): Prisma.Decimal | { error: string } {
  const s = raw.trim().replace(",", ".");
  if (!s) return { error: `${label} חסר` };
  try {
    const d = new Prisma.Decimal(s);
    if (d.lte(0)) return { error: `${label} חייב להיות חיובי` };
    return d.toDecimalPlaces(6, 4);
  } catch {
    return { error: `${label} לא תקין` };
  }
}

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

/** שערים מהמסך — ללא query ל-FinancialSettings בזמן save */
export function resolveCaptureFinancialFromForm(
  snapshot: CaptureFinancialSnapshotInput | null | undefined,
  finalRateOverride?: string | null,
): { ok: true; rates: CaptureFinancialResolved } | { ok: false; error: string } {
  if (!snapshot?.baseDollarRate || !snapshot.dollarFee || !snapshot.finalDollarRate) {
    return { ok: false, error: "חסרים נתוני שער מהמסך" };
  }

  const baseParsed = parsePositiveDecimal(snapshot.baseDollarRate, "שער בסיס");
  if (!(baseParsed instanceof Prisma.Decimal)) return { ok: false, error: baseParsed.error };

  const feeParsed = parsePositiveDecimal(snapshot.dollarFee, "עמלת דולר");
  if (!(feeParsed instanceof Prisma.Decimal)) return { ok: false, error: feeParsed.error };

  let finalParsed = parsePositiveDecimal(snapshot.finalDollarRate, "שער דולר סופי");
  if (!(finalParsed instanceof Prisma.Decimal)) return { ok: false, error: finalParsed.error };

  const rateOv = finalRateOverride?.trim().replace(",", ".");
  if (rateOv) {
    const ov = parsePositiveDecimal(rateOv, "שער דולר");
    if (!(ov instanceof Prisma.Decimal)) return { ok: false, error: ov.error };
    finalParsed = ov;
  }

  return { ok: true, rates: { base: baseParsed, fee: feeParsed, final: finalParsed } };
}

export function parseEnabledCountriesFromForm(
  raw: string[] | null | undefined,
): OrderCountryCode[] | null {
  if (!raw?.length) return null;
  const allowed = new Set<string>(ORDER_COUNTRY_CODES);
  const list = raw.filter((c): c is OrderCountryCode => allowed.has(c));
  return list.length > 0 ? list : null;
}
