import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import { appendFlowFxPurchase } from "@/lib/flow-control/services/exchange-service";
import { saveFlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";
import { syncCashCountTurkeyAllocationInTx } from "@/lib/flow-control/turkey-transfer-balance-service";
import type { ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import { dec } from "@/app/admin/cash-flow/week-flow-service";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";

function fcNum(v: string | null | undefined): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function persistManagerCount(input: {
  week: string;
  form: ManagerCountForm;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

  const f = input.form;
  const allocationUsd = fcNum(f.turkeyTransferUsd);

  await prisma.$transaction(async (tx) => {
    const flowRow = await tx.cashWeekFlow.upsert({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      create: {
        countryCode: "TR",
        weekCode: wk,
        countedCashUsd: dec(f.countedCashUsd),
        countedCashIls: dec(f.countedCashIls),
        countedChecksIls: dec(f.countedChecksIls),
        countedCreditIls: dec(f.countedCreditIls),
        countedTransferIls: dec(f.countedTransferIls),
        commissionUsd: dec(f.commissionUsd),
        commissionIls: dec(f.commissionIls),
        turkeyTransferUsd: dec(f.turkeyTransferUsd),
        updatedById: input.updatedById,
      },
      update: {
        countedCashUsd: dec(f.countedCashUsd),
        countedCashIls: dec(f.countedCashIls),
        countedChecksIls: dec(f.countedChecksIls),
        countedCreditIls: dec(f.countedCreditIls),
        countedTransferIls: dec(f.countedTransferIls),
        commissionUsd: dec(f.commissionUsd),
        commissionIls: dec(f.commissionIls),
        turkeyTransferUsd: dec(f.turkeyTransferUsd),
        updatedById: input.updatedById,
      },
    });

    await syncCashCountTurkeyAllocationInTx(tx, {
      weekCode: wk,
      cashWeekFlowId: flowRow.id,
      allocationUsd,
      userId: input.updatedById,
      note: "הקצאה מספירת קופה — לטורקיה PS",
    });
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
  intakeAllocations?: import("@/app/admin/cash-flow/flow-types").FxPurchaseRecord["intakeAllocations"];
  intakeProfitIls?: number;
  intakeLossIls?: number;
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
    intakeAllocations: input.intakeAllocations,
    intakeProfitIls: input.intakeProfitIls,
    intakeLossIls: input.intakeLossIls,
    updatedById: input.updatedById,
    createdByName: input.createdByName,
  });

  if (res.ok) revalidatePath("/admin/cash-flow");
  return res;
}

/** @deprecated — העברות בפועל דרך saveTurkeyActualTransferAction */
export async function persistTurkeyTransfer(_input: {
  week: string;
  turkeyTransferUsd: number | string | null;
  updatedById: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "השתמש בפעולת «העברה לטורקיה»" };
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

export async function persistTurkeyActualTransfer(input: {
  week: string;
  currency: "USD" | "ILS";
  amount: number;
  reference?: string | null;
  notes?: string | null;
  transferDate?: string | null;
  userId: string;
}): Promise<{ ok: boolean; error?: string; movementId?: string }> {
  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

  try {
    const movementId = await prisma.$transaction(async (tx) => {
      const { createTurkeyTransferInTx } = await import(
        "@/lib/flow-control/turkey-transfer-balance-service"
      );
      const res = await createTurkeyTransferInTx(tx, {
        weekCode: wk,
        currency: input.currency,
        amount: input.amount,
        userId: input.userId,
        reference: input.reference,
        notes: input.notes,
        transferDate: input.transferDate ? new Date(input.transferDate) : undefined,
      });
      return res.id;
    });
    revalidatePath("/admin/cash-flow");
    return { ok: true, movementId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שמירת העברה נכשלה" };
  }
}
