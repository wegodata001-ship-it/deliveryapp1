"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { finalRateFromBaseAndFee } from "@/lib/financial-calc";
import { getCurrentFinancialSettings } from "@/lib/financial-settings";
import { prisma } from "@/lib/prisma";

export type FinancialSaveState = { ok: true } | { ok: false; error: string };

export async function saveManualFinancialSettings(input: {
  baseDollarRate: string;
  dollarFee: string;
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

  const final = finalRateFromBaseAndFee(base, fee);

  await prisma.financialSettings.create({
    data: {
      baseDollarRate: base,
      dollarFee: fee,
      finalDollarRate: final,
      source: "MANUAL",
      updatedById: me.id,
    },
  });

  revalidatePath("/admin");
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
  const mockBase = new Prisma.Decimal("3.40");
  const final = finalRateFromBaseAndFee(mockBase, fee);

  await prisma.financialSettings.create({
    data: {
      baseDollarRate: mockBase,
      dollarFee: fee,
      finalDollarRate: final,
      source: "AUTO",
      updatedById: me.id,
    },
  });

  revalidatePath("/admin");
  return { ok: true };
}
