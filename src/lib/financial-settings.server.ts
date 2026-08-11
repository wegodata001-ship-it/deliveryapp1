import "server-only";

import { Prisma, type FinancialSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import {
  FINANCE_SOURCE_TABLE,
  logFinanceLoadedValues,
  logFinanceSaveTarget,
  logFinanceSourceTable,
} from "@/lib/finance-log";
import {
  FINANCIAL_SETTINGS_DEFAULTS,
  serializeFinancialRowFromDb,
  type FinancialSettingsDbRow,
  type SerializedFinancial,
} from "@/lib/financial-settings.shared";

export {
  FINANCIAL_SETTINGS_DEFAULTS,
  serializeFinancialRowFromDb,
  serializeFinancialSettings,
  defaultSerializedFinancial,
  formatDecimalField,
  type SerializedFinancial,
  type FinancialSettingsDbRow,
} from "@/lib/financial-settings.shared";

const financialSelect = {
  id: true,
  baseDollarRate: true,
  dollarFee: true,
  finalDollarRate: true,
  defaultCommissionPercent: true,
  source: true,
  updatedAt: true,
  updatedBy: { select: { fullName: true } },
} as const;

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

/** שאילתה אחת לטעינת מודאל — ללא cache, ללא count */
export async function loadLatestFinancialSettingsRow(): Promise<FinancialSettingsDbRow | null> {
  return prisma.financialSettings.findFirst({
    orderBy: { updatedAt: "desc" },
    select: financialSelect,
  });
}

/**
 * מקור אמת יחיד — טעינה מ-FinancialSettings בלבד (ללא Order / Payment / cache layout).
 * @param consumer מזהה מסך/action ללוג ([finance] loaded values)
 */
export async function loadFinanceSettingsSerialized(consumer: string): Promise<SerializedFinancial> {
  logFinanceSourceTable(consumer);
  const t0 = Date.now();
  const row = await loadLatestFinancialSettingsRow();
  const settings = serializeFinancialRowFromDb(row);
  logFinanceLoadedValues(consumer, {
    id: row?.id ?? null,
    ms: Date.now() - t0,
    baseDollarRate: settings.baseDollarRate,
    dollarFee: settings.dollarFee,
    finalDollarRate: settings.finalDollarRate,
    defaultCommissionPercent: settings.defaultCommissionPercent,
  });
  return settings;
}

export type PersistFinanceSettingsInput = {
  consumer: string;
  baseDollarRate: Prisma.Decimal;
  dollarFee: Prisma.Decimal;
  defaultCommissionPercent: Prisma.Decimal;
  source?: string;
  updatedById?: string | null;
};

/** כתיבה יחידה ל-FinancialSettings — רק ממודאל הגדרות / מקורות מנהל מפורשים */
export async function persistFinanceSettingsRow(input: PersistFinanceSettingsInput) {
  logFinanceSaveTarget(input.consumer, FINANCE_SOURCE_TABLE, {
    base: input.baseDollarRate.toString(),
    fee: input.dollarFee.toString(),
    commission: input.defaultCommissionPercent.toString(),
  });
  const final = finalRateFromBaseAndFee(input.baseDollarRate, input.dollarFee);
  return prisma.financialSettings.create({
    data: {
      baseDollarRate: input.baseDollarRate,
      dollarFee: input.dollarFee,
      finalDollarRate: final,
      defaultCommissionPercent: input.defaultCommissionPercent,
      source: input.source ?? "MANUAL",
      updatedById: input.updatedById ?? undefined,
    },
    select: financialSelect,
  });
}

export async function ensureDefaultFinancialSettings(): Promise<FinancialSettings> {
  const existing = await getCurrentFinancialSettings();
  if (existing) return existing;

  const base = new Prisma.Decimal(FINANCIAL_SETTINGS_DEFAULTS.baseDollarRate);
  const fee = new Prisma.Decimal(FINANCIAL_SETTINGS_DEFAULTS.dollarFee);

  await persistFinanceSettingsRow({
    consumer: "ensure-default",
    baseDollarRate: base,
    dollarFee: fee,
    defaultCommissionPercent: new Prisma.Decimal(0),
    source: "MANUAL",
  });
  const created = await getCurrentFinancialSettings();
  if (!created) throw new Error("Failed to seed FinancialSettings");
  return created;
}
