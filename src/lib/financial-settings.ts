import { Prisma, type FinancialSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";

export async function getCurrentFinancialSettings(): Promise<FinancialSettings | null> {
  return prisma.financialSettings.findFirst({
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCurrentFinancialSettingsWithUser(): Promise<
  (FinancialSettings & { updatedBy: { fullName: string } | null }) | null
> {
  return prisma.financialSettings.findFirst({
    orderBy: { updatedAt: "desc" },
    include: { updatedBy: { select: { fullName: true } } },
  });
}

export async function ensureDefaultFinancialSettings(): Promise<FinancialSettings> {
  const existing = await getCurrentFinancialSettings();
  if (existing) return existing;

  const base = new Prisma.Decimal("3.40");
  const fee = new Prisma.Decimal("0.10");
  const final = finalRateFromBaseAndFee(base, fee);

  return prisma.financialSettings.create({
    data: {
      baseDollarRate: base,
      dollarFee: fee,
      finalDollarRate: final,
      defaultCommissionPercent: new Prisma.Decimal(0),
      source: "MANUAL",
    },
  });
}

export type SerializedFinancial = {
  baseDollarRate: string;
  dollarFee: string;
  finalDollarRate: string;
  defaultCommissionPercent: string;
  source: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** Prisma Decimal נהרס ל-string/number אחרי unstable_cache — פורמט אחיד */
export function formatDecimalField(value: unknown, decimals = 4): string {
  if (value == null) return (0).toFixed(decimals);
  if (value instanceof Prisma.Decimal) return value.toFixed(decimals);
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(decimals);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(decimals) : value;
  }
  const n = Number(String(value));
  return Number.isFinite(n) ? n.toFixed(decimals) : (0).toFixed(decimals);
}

function formatUpdatedAt(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function serializeFinancialSettings(
  row: (FinancialSettings & { updatedBy?: { fullName: string } | null }) | null | Record<string, unknown>,
): SerializedFinancial | null {
  if (!row) return null;
  const r = row as FinancialSettings & { updatedBy?: { fullName: string } | null };
  return {
    baseDollarRate: formatDecimalField(r.baseDollarRate),
    dollarFee: formatDecimalField(r.dollarFee),
    finalDollarRate: formatDecimalField(r.finalDollarRate),
    defaultCommissionPercent: formatDecimalField(r.defaultCommissionPercent),
    source: String(r.source ?? ""),
    updatedAt: formatUpdatedAt(r.updatedAt),
    updatedByName: r.updatedBy?.fullName ?? null,
  };
}
