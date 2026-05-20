import { Prisma } from "@prisma/client";

/** תצוגת סכומי תשלום — דולר ושקל בשורות נפרדות (ללא המרה) */
export function formatDualPaymentAmountLines(
  usd: Prisma.Decimal | number | string | null | undefined,
  ils: Prisma.Decimal | number | string | null | undefined,
): string[] {
  const lines: string[] = [];
  const u = decToDisplay(usd);
  const i = decToDisplay(ils);
  if (u != null && u > 0) lines.push(`$${u.toFixed(2)}`);
  if (i != null && i > 0) lines.push(`₪${i.toFixed(2)}`);
  return lines;
}

export function formatDualPaymentAmountBlock(
  usd: Prisma.Decimal | number | string | null | undefined,
  ils: Prisma.Decimal | number | string | null | undefined,
  fallback = "—",
): string {
  const lines = formatDualPaymentAmountLines(usd, ils);
  return lines.length > 0 ? lines.join("\n") : fallback;
}

function decToDisplay(v: Prisma.Decimal | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n =
    v instanceof Prisma.Decimal
      ? Number(v.toFixed(4))
      : typeof v === "number"
        ? v
        : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}
