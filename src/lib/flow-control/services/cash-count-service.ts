/**
 * CashCountService — ספירת מנהל + הוצאות קופה.
 * קורא מ-CashWeekFlow ו-CashExpense בלבד.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { aggregateExpensesByMethod, cashDrawerExpenseTotals } from "@/lib/cash-expense-payment-method";
import { cashExpenseWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { flowWeekCompositeKey, type FlowWorkScope } from "@/lib/flow-control/flow-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";

export type FlowWeekCashCount = {
  countedCashUsd: number | null;
  countedCashIls: number | null;
  countedChecksIls: number | null;
  countedCreditIls: number | null;
  countedTransferIls: number | null;
  commissionUsd: number;
  commissionIls: number;
  turkeyTransferUsd: number | null;
  turkeyTransferIls: number | null;
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

export async function loadFlowWeekCashCount(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowWeekCashCount> {
  const wk = weekCode.trim();
  const scope: FlowWorkScope = { workCountry };
  const countryScope = resolveCountryScopeFromCode(workCountry);
  const [flowRow, expenses] = await Promise.all([
    prisma.cashWeekFlow.findUnique({
      where: flowWeekCompositeKey(scope, wk),
    }),
    prisma.cashExpense.findMany({
      where: { ...cashExpenseWhereForCountryScope(countryScope), weekCode: wk, status: "ACTIVE" },
      select: { currency: true, amount: true, paymentMethod: true },
    }),
  ]);

  const byMethod = aggregateExpensesByMethod(expenses);
  const cashExp = cashDrawerExpenseTotals(byMethod);

  return {
    countedCashUsd: decToNum(flowRow?.countedCashUsd),
    countedCashIls: decToNum(flowRow?.countedCashIls),
    countedChecksIls: decToNum(flowRow?.countedChecksIls),
    countedCreditIls: decToNum(flowRow?.countedCreditIls),
    countedTransferIls: decToNum(flowRow?.countedTransferIls),
    commissionUsd: numDec(flowRow?.commissionUsd),
    commissionIls: numDec(flowRow?.commissionIls),
    turkeyTransferUsd: decToNum(flowRow?.turkeyTransferUsd),
    turkeyTransferIls: decToNum(flowRow?.turkeyTransferIls),
    expensesIls: cashExp.ils,
    expensesUsd: cashExp.usd,
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
  turkeyTransferIls: Prisma.Decimal | null;
};

export async function saveFlowWeekCashCount(input: {
  weekCode: string;
  workCountry?: WorkCountryCode;
  data: FlowManagerCountPersist;
  updatedById: string;
}): Promise<void> {
  const wk = input.weekCode.trim();
  const workCountry = input.workCountry ?? DEFAULT_WORK_COUNTRY;
  const scope: FlowWorkScope = { workCountry };
  await prisma.cashWeekFlow.upsert({
    where: flowWeekCompositeKey(scope, wk),
    create: {
      countryCode: workCountry,
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
