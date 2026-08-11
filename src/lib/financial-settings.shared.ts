/** Client-safe financial settings types/constants — no Prisma, no DB. */

export const FINANCIAL_SETTINGS_DEFAULTS = {
  baseDollarRate: "3.40",
  dollarFee: "0.10",
  defaultCommissionPercent: "0",
} as const;

export type SerializedFinancial = {
  baseDollarRate: string;
  dollarFee: string;
  finalDollarRate: string;
  defaultCommissionPercent: string;
  source: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type FinancialSettingsDbRow = {
  id?: string;
  baseDollarRate: unknown;
  dollarFee: unknown;
  finalDollarRate: unknown;
  defaultCommissionPercent: unknown;
  source?: unknown;
  updatedAt?: unknown;
  updatedBy?: { fullName: string } | null;
};

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

function hasToFixed(value: unknown): value is { toFixed: (n: number) => string } {
  return (
    value != null &&
    typeof value === "object" &&
    "toFixed" in value &&
    typeof (value as { toFixed: unknown }).toFixed === "function"
  );
}

/** Prisma Decimal / number / string — פורמט אחיד ללא import מ-@prisma/client */
export function formatDecimalField(value: unknown, decimals = 4): string {
  if (value == null) return (0).toFixed(decimals);
  if (hasToFixed(value)) return value.toFixed(decimals);
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
  row: FinancialSettingsDbRow | Record<string, unknown> | null | undefined,
): SerializedFinancial | null {
  if (!row) return null;
  const r = row as FinancialSettingsDbRow;
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
  row: FinancialSettingsDbRow | null | undefined,
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
