"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { parseCommissionPercentString, sanitizeCommissionPercentInput } from "@/lib/commission-percent";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import { getCurrentFinancialSettings } from "@/lib/financial-settings";
import { prisma } from "@/lib/prisma";
import { invalidateCaptureHotPathCache } from "@/lib/capture-hot-path";
import { FINANCIAL_LAYOUT_CACHE_TAG } from "@/lib/admin-layout-cache";
import { recordActivityAudit } from "@/lib/activity-audit";

export type FinancialSaveState = { ok: true } | { ok: false; error: string };

function parseCommissionPercentField(raw: string): { ok: true; value: Prisma.Decimal } | { ok: false; error: string } {
  const cleaned = sanitizeCommissionPercentInput(raw.trim());
  const n = parseCommissionPercentString(cleaned);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "אחוז עמלה לא תקין" };
  if (n > 100) return { ok: false, error: "אחוז עמלה לא יכול לעלות על 100" };
  return { ok: true, value: new Prisma.Decimal(n.toString()).toDecimalPlaces(4, 4) };
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

  let base: Prisma.Decimal;
  let fee: Prisma.Decimal;
  try {
    base = new Prisma.Decimal(input.baseDollarRate.trim().replace(",", "."));
    fee = new Prisma.Decimal((input.dollarFee || "0").trim().replace(",", "."));
  } catch {
    return { ok: false, error: "ערכי שער לא תקינים" };
  }

  if (base.lte(0)) return { ok: false, error: "שער בסיס חייב להיות חיובי" };
  if (fee.lt(0)) return { ok: false, error: "עמלה לא יכולה להיות שלילית" };

  const pctParsed = parseCommissionPercentField(input.defaultCommissionPercent ?? "0");
  if (!pctParsed.ok) return { ok: false, error: pctParsed.error };

  const oldSettings = await getCurrentFinancialSettings();
  const final = finalRateFromBaseAndFee(base, fee);

  await prisma.financialSettings.create({
    data: {
      baseDollarRate: base,
      dollarFee: fee,
      finalDollarRate: final,
      defaultCommissionPercent: pctParsed.value,
      source: "MANUAL",
      updatedById: me.id,
    },
  });

  invalidateCaptureHotPathCache();
  revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/settings");

  recordActivityAudit({
    userId: me.id,
    actionType: "FINANCE_SETTINGS_UPDATED",
    entityType: "FinancialSettings",
    metadata: {
      oldBaseDollarRate: oldSettings?.baseDollarRate?.toString() ?? null,
      oldDollarFee: oldSettings?.dollarFee?.toString() ?? null,
      oldDefaultCommissionPercent: oldSettings?.defaultCommissionPercent?.toString() ?? null,
      newBaseDollarRate: base.toString(),
      newDollarFee: fee.toString(),
      newFinalDollarRate: final.toString(),
      newDefaultCommissionPercent: pctParsed.value.toString(),
    },
  });

  return { ok: true };
}

/** דמו: שער אוטומטי קבוע; ניתן לחבר ספק חיצוני */
export async function refreshAutomaticDollarRate(): Promise<FinancialSaveState> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  const latest = await getCurrentFinancialSettings();
  const fee = latest?.dollarFee ?? new Prisma.Decimal(0);
  const defaultPct = latest?.defaultCommissionPercent ?? new Prisma.Decimal(0);
  const mockBase = new Prisma.Decimal("3.40");
  const final = finalRateFromBaseAndFee(mockBase, fee);

  await prisma.financialSettings.create({
    data: {
      baseDollarRate: mockBase,
      dollarFee: fee,
      finalDollarRate: final,
      defaultCommissionPercent: defaultPct,
      source: "AUTO",
      updatedById: me.id,
    },
  });

  invalidateCaptureHotPathCache();
  revalidateTag(FINANCIAL_LAYOUT_CACHE_TAG);
  revalidatePath("/admin", "layout");

  recordActivityAudit({
    userId: me.id,
    actionType: "FINANCE_SETTINGS_UPDATED",
    entityType: "FinancialSettings",
    metadata: {
      oldBaseDollarRate: latest?.baseDollarRate?.toString() ?? null,
      newBaseDollarRate: mockBase.toString(),
      source: "AUTO",
    },
  });

  return { ok: true };
}
