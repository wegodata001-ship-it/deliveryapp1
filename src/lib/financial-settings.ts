import { Prisma, type FinancialSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";

export async function getCurrentFinancialSettings(): Promise<FinancialSettings | null> {
  return prisma.financialSettings.findFirst({
    orderBy: { updatedAt: "desc" },
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
      source: "MANUAL",
    },
  });
}

export type SerializedFinancial = {
  baseDollarRate: string;
  dollarFee: string;
  finalDollarRate: string;
  source: string;
  updatedAt: string | null;
};

export function serializeFinancialSettings(row: FinancialSettings | null): SerializedFinancial | null {
  if (!row) return null;
  return {
    baseDollarRate: row.baseDollarRate.toFixed(4),
    dollarFee: row.dollarFee.toFixed(4),
    finalDollarRate: row.finalDollarRate.toFixed(4),
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}
