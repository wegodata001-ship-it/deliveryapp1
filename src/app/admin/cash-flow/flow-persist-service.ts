import { revalidatePath } from "next/cache";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import { appendFlowFxPurchase } from "@/lib/flow-control/services/exchange-service";
import { saveFlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";
import { saveFlowWeekTurkeyTransfer } from "@/lib/flow-control/services/turkey-transfer-service";
import type { ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { dec } from "@/app/admin/cash-flow/week-flow-service";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function persistManagerCount(input: {
  week: string;
  form: ManagerCountForm;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

  const f = input.form;
  await saveFlowWeekCashCount({
    weekCode: wk,
    updatedById: input.updatedById,
    data: {
      countedCashUsd: dec(f.countedCashUsd),
      countedCashIls: dec(f.countedCashIls),
      countedChecksIls: dec(f.countedChecksIls),
      countedCreditIls: dec(f.countedCreditIls),
      countedTransferIls: dec(f.countedTransferIls),
      commissionUsd: dec(f.commissionUsd),
      commissionIls: dec(f.commissionIls),
      turkeyTransferUsd: dec(f.turkeyTransferUsd),
    },
  });

  revalidatePath("/admin/cash-flow");
  return { ok: true };
}

export async function persistFxPurchase(input: {
  week: string;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
  note?: string | null;
  updatedById: string;
  createdByName?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

  const res = await appendFlowFxPurchase({
    weekCode: wk,
    ilsAmount: input.ilsAmount,
    rate: input.rate,
    remainderCashIls: input.remainderCashIls,
    remainderBankIls: input.remainderBankIls,
    note: input.note,
    updatedById: input.updatedById,
    createdByName: input.createdByName,
  });

  if (res.ok) revalidatePath("/admin/cash-flow");
  return res;
}

/** @deprecated — turkey transfer נשמר דרך persistManagerCount */
export async function persistTurkeyTransfer(input: {
  week: string;
  turkeyTransferUsd: number | string | null;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

  await saveFlowWeekTurkeyTransfer({
    weekCode: wk,
    turkeyTransferUsd: dec(input.turkeyTransferUsd),
    updatedById: input.updatedById,
  });

  revalidatePath("/admin/cash-flow");
  return { ok: true };
}

/** @deprecated — for week-flow-actions backward compat */
export async function persistLegacyWeekFlow(input: {
  week: string;
  counted?: Partial<Record<CashWeekFlowLineId, number | string | null>>;
  fxPurchaseIls?: number | string | null;
  fxPurchaseUsd?: number | string | null;
  turkeyTransferUsd?: number | string | null;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  const c = input.counted ?? {};
  await prisma.cashWeekFlow.upsert({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    create: {
      countryCode: "TR",
      weekCode: wk,
      countedCashIls: dec(c.CASH_ILS),
      countedCashUsd: dec(c.CASH_USD),
      countedCreditIls: dec(c.CREDIT),
      countedChecksIls: dec(c.CHECK),
      countedTransferIls: dec(c.BANK_TRANSFER),
      fxPurchaseIls: dec(input.fxPurchaseIls),
      fxPurchaseUsd: dec(input.fxPurchaseUsd),
      turkeyTransferUsd: dec(input.turkeyTransferUsd),
      updatedById: input.updatedById,
    },
    update: {
      ...(input.counted !== undefined
        ? {
            countedCashIls: dec(c.CASH_ILS),
            countedCashUsd: dec(c.CASH_USD),
            countedCreditIls: dec(c.CREDIT),
            countedChecksIls: dec(c.CHECK),
            countedTransferIls: dec(c.BANK_TRANSFER),
          }
        : {}),
      ...(input.fxPurchaseIls !== undefined ? { fxPurchaseIls: dec(input.fxPurchaseIls) } : {}),
      ...(input.fxPurchaseUsd !== undefined ? { fxPurchaseUsd: dec(input.fxPurchaseUsd) } : {}),
      ...(input.turkeyTransferUsd !== undefined ? { turkeyTransferUsd: dec(input.turkeyTransferUsd) } : {}),
      updatedById: input.updatedById,
    },
  });
  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}
