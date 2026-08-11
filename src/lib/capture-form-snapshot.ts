import "server-only";

import { Prisma } from "@prisma/client";
import {
  buildCaptureFinancialSnapshot,
  parseEnabledCountriesFromForm,
  type CaptureCustomerSnapshotInput,
  type CaptureFinancialSnapshotInput,
} from "@/lib/capture-form-snapshot.shared";

export {
  buildCaptureFinancialSnapshot,
  parseEnabledCountriesFromForm,
  type CaptureCustomerSnapshotInput,
  type CaptureFinancialSnapshotInput,
} from "@/lib/capture-form-snapshot.shared";

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
