"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { FINANCIAL_LAYOUT_CACHE_TAG } from "@/lib/admin-layout-cache";
import { parseCommissionPercentString, sanitizeCommissionPercentInput } from "@/lib/commission-percent";
import {
  FINANCIAL_SETTINGS_DEFAULTS,
  loadFinanceSettingsSerialized,
  loadLatestFinancialSettingsRow,
  persistFinanceSettingsRow,
  serializeFinancialRowFromDb,
  type SerializedFinancial,
} from "@/lib/financial-settings";
import { invalidateCaptureHotPathCache } from "@/lib/capture-hot-path";
import { recordActivityAudit } from "@/lib/activity-audit";

export type FinancialSaveState =
  | { ok: true; settings: SerializedFinancial }
  | { ok: false; error: string };

function logFinance(event: string, data?: Record<string, unknown>): void {
  console.log(`[finance-settings] ${event}`, data ?? "");
}

function parseCommissionPercentField(raw: string): { ok: true; value: Prisma.Decimal } | { ok: false; error: string } {
  const cleaned = sanitizeCommissionPercentInput(raw.trim());
  const n = parseCommissionPercentString(cleaned);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "אחוז עמלה לא תקין" };
  if (n > 100) return { ok: false, error: "אחוז עמלה לא יכול לעלות על 100" };
  return { ok: true, value: new Prisma.Decimal(n.toString()).toDecimalPlaces(4, 4) };
}

function afterFinancialSettingsChanged(): void {
  invalidateCaptureHotPathCache();
  revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/settings");
}

/** טעינת הגדרות למודאל — query אחד, ללא cache */
export async function loadFinancialSettingsAction(): Promise<SerializedFinancial> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    logFinance("loaded", { denied: true });
    return serializeFinancialRowFromDb(null);
  }
  return loadFinanceSettingsSerialized("admin-settings");
}

function captureFinancePermissions(me: Awaited<ReturnType<typeof requireAuth>>): boolean {
  return userHasAnyPermission(me, [
    "create_orders",
    "edit_orders",
    "receive_payments",
    "manage_settings",
  ]);
}

/** טעינה לקליטת הזמנה — FinancialSettings בלבד */
export async function loadFinancialSettingsForCaptureAction(): Promise<SerializedFinancial> {
  const me = await requireAuth();
  if (!captureFinancePermissions(me)) return serializeFinancialRowFromDb(null);
  return loadFinanceSettingsSerialized("order-capture");
}

/** טעינה לקליטת תשלום — אותו מקור כמו הזמנה */
export async function loadFinancialSettingsForPaymentCaptureAction(): Promise<SerializedFinancial> {
  const me = await requireAuth();
  if (!captureFinancePermissions(me)) return serializeFinancialRowFromDb(null);
  return loadFinanceSettingsSerialized("payment-capture");
}

export async function saveManualFinancialSettings(input: {
  baseDollarRate: string;
  dollarFee: string;
  defaultCommissionPercent: string;
}): Promise<FinancialSaveState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  logFinance("save request", {
    baseDollarRate: input.baseDollarRate,
    dollarFee: input.dollarFee,
    defaultCommissionPercent: input.defaultCommissionPercent,
    userId: me.id,
  });

  let base: Prisma.Decimal;
  let fee: Prisma.Decimal;
  try {
    base = new Prisma.Decimal(input.baseDollarRate.trim().replace(",", "."));
    fee = new Prisma.Decimal((input.dollarFee || "0").trim().replace(",", "."));
  } catch {
    return { ok: false, error: "שגיאה בשמירה" };
  }

  if (base.lte(0)) return { ok: false, error: "שער בסיס חייב להיות חיובי" };
  if (fee.lt(0)) return { ok: false, error: "עמלה לא יכולה להיות שלילית" };

  const pctParsed = parseCommissionPercentField(input.defaultCommissionPercent ?? "0");
  if (!pctParsed.ok) return { ok: false, error: pctParsed.error };

  const oldRow = await loadLatestFinancialSettingsRow();

  const saved = await persistFinanceSettingsRow({
    consumer: "financial-modal-save",
    baseDollarRate: base,
    dollarFee: fee,
    defaultCommissionPercent: pctParsed.value,
    source: "MANUAL",
    updatedById: me.id,
  });

  const settings = serializeFinancialRowFromDb(
    { ...saved, updatedBy: { fullName: me.fullName } },
    me.fullName,
  );

  logFinance("saved", {
    id: saved.id,
    baseDollarRate: settings.baseDollarRate,
    dollarFee: settings.dollarFee,
    defaultCommissionPercent: settings.defaultCommissionPercent,
    finalDollarRate: settings.finalDollarRate,
    updatedById: me.id,
  });

  afterFinancialSettingsChanged();

  recordActivityAudit({
    userId: me.id,
    actionType: "FINANCE_SETTINGS_UPDATED",
    entityType: "FinancialSettings",
    metadata: {
      oldBaseDollarRate: oldRow?.baseDollarRate?.toString() ?? null,
      oldDollarFee: oldRow?.dollarFee?.toString() ?? null,
      oldDefaultCommissionPercent: oldRow?.defaultCommissionPercent?.toString() ?? null,
      newBaseDollarRate: base.toString(),
      newDollarFee: fee.toString(),
      newFinalDollarRate: settings.finalDollarRate,
      newDefaultCommissionPercent: pctParsed.value.toString(),
    },
  });

  return { ok: true, settings };
}

/** איפוס לברירת מחדל מערכת (3.40 + 0.10 + 0% עמלה) */
export async function resetFinancialSettingsToDefaultsAction(): Promise<FinancialSaveState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  logFinance("save request", { reset: true, userId: me.id });

  const base = new Prisma.Decimal(FINANCIAL_SETTINGS_DEFAULTS.baseDollarRate);
  const fee = new Prisma.Decimal(FINANCIAL_SETTINGS_DEFAULTS.dollarFee);

  const saved = await persistFinanceSettingsRow({
    consumer: "financial-modal-reset",
    baseDollarRate: base,
    dollarFee: fee,
    defaultCommissionPercent: new Prisma.Decimal(0),
    source: "MANUAL",
    updatedById: me.id,
  });

  const settings = serializeFinancialRowFromDb(
    { ...saved, updatedBy: { fullName: me.fullName } },
    me.fullName,
  );

  logFinance("saved", { reset: true, id: saved.id, ...settings });

  afterFinancialSettingsChanged();

  recordActivityAudit({
    userId: me.id,
    actionType: "FINANCE_SETTINGS_UPDATED",
    entityType: "FinancialSettings",
    metadata: { resetToDefaults: true },
  });

  return { ok: true, settings };
}
