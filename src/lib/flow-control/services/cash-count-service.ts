/**
 * CashCountService — ספירת מנהל + הוצאות קופה.
 * קורא מ-CashWeekFlow ו-CashExpense בלבד.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";

export type FlowWeekCashCount = {
  countedCashUsd: number | null;
  countedCashIls: number | null;
  countedChecksIls: number | null;
  countedCreditIls: number | null;
  countedTransferIls: number | null;
  commissionUsd: number;
  commissionIls: number;
  expensesIls: number;
  expensesUsd: number;
};

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function decToNum(v: Prisma.Decimal | null | undefined): number | null {
  if (v == null) return null;
  const n = numDec(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadFlowWeekCashCount(weekCode: string): Promise<FlowWeekCashCount> {
  const wk = weekCode.trim();
  const [flowRow, expenses] = await Promise.all([
    prisma.cashWeekFlow.findUnique({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      select: { currency: true, amount: true },
    }),
  ]);

  let expensesIls = 0;
  let expensesUsd = 0;
  for (const e of expenses) {
    const amt = numDec(e.amount);
    if (e.currency === "USD") expensesUsd += amt;
    else expensesIls += amt;
  }

  return {
    countedCashUsd: decToNum(flowRow?.countedCashUsd),
    countedCashIls: decToNum(flowRow?.countedCashIls),
    countedChecksIls: decToNum(flowRow?.countedChecksIls),
    countedCreditIls: decToNum(flowRow?.countedCreditIls),
    countedTransferIls: decToNum(flowRow?.countedTransferIls),
    commissionUsd: numDec(flowRow?.commissionUsd),
    commissionIls: numDec(flowRow?.commissionIls),
    expensesIls: Math.round(expensesIls * 100) / 100,
    expensesUsd: Math.round(expensesUsd * 100) / 100,
  };
}

export type FlowManagerCountPersist = {
  countedCashUsd: Prisma.Decimal | null;
  countedCashIls: Prisma.Decimal | null;
  countedChecksIls: Prisma.Decimal | null;
  countedCreditIls: Prisma.Decimal | null;
  countedTransferIls: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
  commissionIls: Prisma.Decimal | null;
  turkeyTransferUsd: Prisma.Decimal | null;
};

export async function saveFlowWeekCashCount(input: {
  weekCode: string;
  data: FlowManagerCountPersist;
  updatedById: string;
}): Promise<void> {
  const wk = input.weekCode.trim();
  await prisma.cashWeekFlow.upsert({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    create: {
      countryCode: "TR",
      weekCode: wk,
      ...input.data,
      updatedById: input.updatedById,
    },
    update: {
      ...input.data,
      updatedById: input.updatedById,
    },
  });
}

export function cashCountToLineIds(
  count: FlowWeekCashCount,
): Partial<Record<CashWeekFlowLineId, number | null>> {
  return {
    CASH_USD: count.countedCashUsd,
    CASH_ILS: count.countedCashIls,
    CHECK: count.countedChecksIls,
    CREDIT: count.countedCreditIls,
    BANK_TRANSFER: count.countedTransferIls,
  };
}
