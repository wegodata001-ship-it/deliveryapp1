import { Prisma, type FinancialSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import {
  FINANCE_SOURCE_TABLE,
  logFinanceLoadedValues,
  logFinanceSaveTarget,
  logFinanceSourceTable,
} from "@/lib/finance-log";

export const FINANCIAL_SETTINGS_DEFAULTS = {
  baseDollarRate: "3.40",
  dollarFee: "0.10",
  defaultCommissionPercent: "0",
} as const;

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
export async function loadLatestFinancialSettingsRow() {
  return prisma.financialSettings.findFirst({
    orderBy: { updatedAt: "desc" },
    select: financialSelect,
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

export function defaultSerializedFinancial(): SerializedFinancial {
  const base = FINANCIAL_SETTINGS_DEFAULTS.baseDollarRate;
  const fee = FINANCIAL_SETTINGS_DEFAULTS.dollarFee;
  const final = (Number(base) + Number(fee)).toFixed(4);
  return {
    baseDollarRate: base,
    dollarFee: fee,
    finalDollarRate: final,
    defaultCommissionPercent: FINANCIAL_SETTINGS_DEFAULTS.defaultCommissionPercent,
    source: "MANUAL",
    updatedAt: null,
    updatedByName: null,
  };
}

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
    defaultCommissionPercent: formatDecimalField(r.defaultCommissionPercent, 4),
    source: String(r.source ?? ""),
    updatedAt: formatUpdatedAt(r.updatedAt),
    updatedByName: r.updatedBy?.fullName ?? null,
  };
}

export function serializeFinancialRowFromDb(
  row: Awaited<ReturnType<typeof loadLatestFinancialSettingsRow>>,
  fallbackUpdatedByName?: string | null,
): SerializedFinancial {
  if (!row) return defaultSerializedFinancial();
  return {
    baseDollarRate: formatDecimalField(row.baseDollarRate),
    dollarFee: formatDecimalField(row.dollarFee),
    finalDollarRate: formatDecimalField(row.finalDollarRate),
    defaultCommissionPercent: formatDecimalField(row.defaultCommissionPercent, 4),
    source: String(row.source ?? "MANUAL"),
    updatedAt: formatUpdatedAt(row.updatedAt),
    updatedByName: row.updatedBy?.fullName ?? fallbackUpdatedByName ?? null,
  };
}
