"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { buildCashReconciliationSummary } from "@/lib/cash-control-reconciliation";
import {
  computeDrawerRemaining,
  countLineDiff,
  WEEK_FLOW_LINE_CHANNEL,
  type CashWeekFlowLineId,
} from "@/lib/cash-control-week-flow";
import { aggregateExpensesByMethod } from "@/lib/cash-expense-payment-method";
import { formatAhWeekLabel, getAhWeekRange } from "@/lib/weeks/ah-week";

const READ_PERMS = ["view_payment_control"];

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function dec(v: number | string | null | undefined): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function lineFromFlow(row: {
  countedCashIls: Prisma.Decimal | null;
  countedCashUsd: Prisma.Decimal | null;
  countedCreditIls: Prisma.Decimal | null;
  countedChecksIls: Prisma.Decimal | null;
  countedTransferIls: Prisma.Decimal | null;
} | null): Partial<Record<CashWeekFlowLineId, string | null>> {
  if (!row) {
    return {
      CASH_ILS: null,
      CASH_USD: null,
      CREDIT: null,
      CHECK: null,
      BANK_TRANSFER: null,
    };
  }
  return {
    CASH_ILS: row.countedCashIls != null ? money(row.countedCashIls) : null,
    CASH_USD: row.countedCashUsd != null ? money(row.countedCashUsd) : null,
    CREDIT: row.countedCreditIls != null ? money(row.countedCreditIls) : null,
    CHECK: row.countedChecksIls != null ? money(row.countedChecksIls) : null,
    BANK_TRANSFER: row.countedTransferIls != null ? money(row.countedTransferIls) : null,
  };
}

export type CashWeekFlowPayload = {
  week: string;
  weekLabel: string | null;
  received: Record<CashWeekFlowLineId, { amount: string; paymentCount: number }>;
  counted: Partial<Record<CashWeekFlowLineId, string | null>>;
  countDiff: Partial<Record<CashWeekFlowLineId, string | null>>;
  expensesIls: string;
  expensesUsd: string;
  fxPurchaseIls: string | null;
  fxPurchaseUsd: string | null;
  turkeyTransferUsd: string | null;
  bankBalanceIls: string | null;
  bankBalanceUsd: string | null;
  drawerRemainingIls: string;
  drawerRemainingUsd: string;
};

export async function getCashWeekFlowAction(week: string): Promise<CashWeekFlowPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const [payments, expenses, flowRow, drawerRows] = await Promise.all([
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
      },
    }),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      select: { currency: true, amount: true, paymentMethod: true },
    }),
    prisma.cashWeekFlow.findUnique({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    }),
    // מקור אמת יחיד: ספירות הקופה היומיות (אותו model של אזור «ספירת קופה»)
    prisma.cashDailyDrawerCount.findMany({
      where: { weekCode: wk },
      select: { cashIls: true, cashUsd: true },
    }),
  ]);

  const summary = buildCashReconciliationSummary(payments);
  const received = Object.fromEntries(
    summary.rows.map((r) => [r.lineId, { amount: money(r.recorded), paymentCount: r.paymentCount }]),
  ) as CashWeekFlowPayload["received"];

  let expensesIls = 0;
  let expensesUsd = 0;
  for (const e of expenses) {
    const amt = numDec(e.amount);
    if (e.currency === "USD") expensesUsd += amt;
    else expensesIls += amt;
  }

  const weekExpensesByMethod = aggregateExpensesByMethod(
    expenses.map((e) => ({
      currency: e.currency,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
    })),
  );

  const counted = lineFromFlow(flowRow);
  const countDiff: Partial<Record<CashWeekFlowLineId, string | null>> = {};
  for (const lineId of ["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[]) {
    const rec = Number(received[lineId]?.amount ?? 0);
    const cnt = counted[lineId] != null ? Number(counted[lineId]) : null;
    const channel = WEEK_FLOW_LINE_CHANNEL[lineId];
    const expAmt = weekExpensesByMethod[channel] ?? 0;
    const diff = countLineDiff(rec, cnt, expAmt);
    countDiff[lineId] = diff != null ? money(diff) : null;
  }

  const fxPurchaseIls = flowRow?.fxPurchaseIls != null ? numDec(flowRow.fxPurchaseIls) : 0;
  const fxPurchaseUsd = flowRow?.fxPurchaseUsd != null ? numDec(flowRow.fxPurchaseUsd) : 0;
  const turkeyTransferUsd = flowRow?.turkeyTransferUsd != null ? numDec(flowRow.turkeyTransferUsd) : 0;

  // סכום ספירות הקופה היומיות (מזומן) — מקור אחד ליתרה שנשארה בקופה
  let dailyCountedCashIls = 0;
  let dailyCountedCashUsd = 0;
  for (const d of drawerRows) {
    dailyCountedCashIls += numDec(d.cashIls);
    dailyCountedCashUsd += numDec(d.cashUsd);
  }

  const remaining = computeDrawerRemaining({
    countedCashIls: dailyCountedCashIls,
    countedCashUsd: dailyCountedCashUsd,
    expensesIls,
    expensesUsd,
    fxPurchaseIls,
    fxPurchaseUsd,
    turkeyTransferUsd,
  });

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    received,
    counted,
    countDiff,
    expensesIls: money(expensesIls),
    expensesUsd: money(expensesUsd),
    fxPurchaseIls: flowRow?.fxPurchaseIls != null ? money(flowRow.fxPurchaseIls) : null,
    fxPurchaseUsd: flowRow?.fxPurchaseUsd != null ? money(flowRow.fxPurchaseUsd) : null,
    turkeyTransferUsd: flowRow?.turkeyTransferUsd != null ? money(flowRow.turkeyTransferUsd) : null,
    bankBalanceIls: flowRow?.bankBalanceIls != null ? money(flowRow.bankBalanceIls) : null,
    bankBalanceUsd: flowRow?.bankBalanceUsd != null ? money(flowRow.bankBalanceUsd) : null,
    drawerRemainingIls: money(remaining.ils),
    drawerRemainingUsd: money(remaining.usd),
  };
}

export async function saveCashWeekFlowAction(input: {
  week: string;
  counted?: Partial<Record<CashWeekFlowLineId, number | string | null>>;
  fxPurchaseIls?: number | string | null;
  fxPurchaseUsd?: number | string | null;
  turkeyTransferUsd?: number | string | null;
  bankBalanceIls?: number | string | null;
  bankBalanceUsd?: number | string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "רק מנהל יכול לעדכן" };

  const wk = input.week.trim();
  if (!getAhWeekRange(wk)) return { ok: false, error: "שבוע לא תקין" };

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
      bankBalanceIls: dec(input.bankBalanceIls),
      bankBalanceUsd: dec(input.bankBalanceUsd),
      updatedById: me.id,
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
      ...(input.bankBalanceIls !== undefined ? { bankBalanceIls: dec(input.bankBalanceIls) } : {}),
      ...(input.bankBalanceUsd !== undefined ? { bankBalanceUsd: dec(input.bankBalanceUsd) } : {}),
      updatedById: me.id,
    },
  });

  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-flow");
  return { ok: true };
}
