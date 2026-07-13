import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { countLineDiff, WEEK_FLOW_LINE_CHANNEL, type CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { aggregateExpensesByMethod } from "@/lib/cash-expense-payment-method";
import { formatAhWeekLabel, getAhWeekRange } from "@/lib/weeks/ah-week";
import {
  computeFlowWeekKpis,
  computeFlowWeekSummary,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import {
  loadFlowWeekBankTransactions,
  loadFlowWeekCashCount,
  loadFlowWeekCashCountSummary,
  loadFlowWeekFxPurchases,
  loadFlowWeekTurkeyTransfer,
  cashCountToLineIds,
} from "@/lib/flow-control/services";
import { loadTurkeyBalanceForWeek } from "@/lib/flow-control/turkey-transfer-balance-service";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function formatCounted(
  lines: Partial<Record<CashWeekFlowLineId, number | null>>,
): Partial<Record<CashWeekFlowLineId, string | null>> {
  const out: Partial<Record<CashWeekFlowLineId, string | null>> = {};
  for (const id of ["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[]) {
    const v = lines[id];
    out[id] = v != null ? money(v) : null;
  }
  return out;
}

export async function loadFlowWeek(week: string): Promise<FlowWeekPayload | null> {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const [approvedSummary, cashCount, fxPurchases, turkeyAllocationUsd, bankTx, turkeyBalance, expenseRows] =
    await Promise.all([
    loadFlowWeekCashCountSummary(wk),
    loadFlowWeekCashCount(wk),
    loadFlowWeekFxPurchases(wk),
    loadFlowWeekTurkeyTransfer(wk),
    loadFlowWeekBankTransactions(wk),
    loadTurkeyBalanceForWeek(wk),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      select: { currency: true, amount: true, paymentMethod: true },
    }),
  ]);

  const weekExpensesByMethod = aggregateExpensesByMethod(
    expenseRows.map((e) => ({
      currency: e.currency,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
    })),
  );

  const actualTurkeyTransfersUsd = turkeyBalance.actualTransfersUsd;

  const received = Object.fromEntries(
    Object.entries(approvedSummary.approved).map(([lineId, t]) => [
      lineId,
      { amount: money(t.amount), paymentCount: t.daysCounted },
    ]),
  ) as FlowWeekPayload["received"];

  const countedLines = cashCountToLineIds(cashCount);
  const counted = formatCounted(countedLines);

  const countDiff: Partial<Record<CashWeekFlowLineId, string | null>> = {};
  for (const lineId of ["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[]) {
    const rec = approvedSummary.approved[lineId]?.amount ?? 0;
    const cnt = countedLines[lineId] ?? null;
    const channel = WEEK_FLOW_LINE_CHANNEL[lineId];
    const expAmt = weekExpensesByMethod[channel] ?? 0;
    const diff = countLineDiff(rec, cnt, expAmt);
    countDiff[lineId] = diff != null ? money(diff) : null;
  }

  const fxTotals = sumFxPurchases(fxPurchases);
  const managerCashUsd = cashCount.countedCashUsd ?? 0;
  const managerCashIls = cashCount.countedCashIls ?? 0;

  const calc = computeFlowWeekSummary({
    countedCashUsd: managerCashUsd,
    countedCashIls: managerCashIls,
    expensesIls: cashCount.expensesIls,
    commissionUsd: cashCount.commissionUsd,
    actualTurkeyTransfersUsd,
    fxPurchases,
    bankWithdrawalsIls: bankTx.withdrawalsIls,
    bankDepositsIls: bankTx.depositsIls,
  });

  const kpis = computeFlowWeekKpis({
    totalReceivedIls: approvedSummary.totalApprovedIls,
    fxTotals: calc.fxTotals,
    turkeyTransferUsd: actualTurkeyTransfersUsd,
    cashIlsInDrawer: calc.cashIlsInDrawer,
    cashUsdInDrawer: calc.cashUsdInDrawer,
    bankBalanceIls: calc.bankBalanceIls,
    fxProfitLoss: calc.fxProfitLoss,
  });

  const lastFx = fxPurchases.length > 0 ? fxPurchases[fxPurchases.length - 1] : null;

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    received,
    counted,
    countDiff,
    expensesIls: money(cashCount.expensesIls),
    expensesUsd: money(cashCount.expensesUsd),
    commissionUsd: cashCount.commissionUsd > 0 ? money(cashCount.commissionUsd) : null,
    commissionIls: cashCount.commissionIls > 0 ? money(cashCount.commissionIls) : null,
    fxPurchaseIls: fxTotals.ils > 0 ? money(fxTotals.ils) : null,
    fxPurchaseUsd: fxTotals.usd > 0 ? money(fxTotals.usd) : null,
    fxRemainderCashIls: lastFx ? money(lastFx.remainderCashIls) : null,
    fxRemainderBankIls: lastFx ? money(lastFx.remainderBankIls) : null,
    fxPurchases,
    fxProfitLoss: calc.fxProfitLoss,
    fxProfitLossHistory: calc.fxProfitLossHistory,
    kpis,
    turkey: calc.turkey,
    turkeyBalance,
    turkeyTransferUsd: turkeyAllocationUsd > 0 ? money(turkeyAllocationUsd) : null,
    bankBalanceIls: money(calc.bankBalanceIls),
    bankBalanceUsd: null,
    drawerRemainingIls: money(calc.cashIlsInDrawer),
    drawerRemainingUsd: money(calc.cashUsdInDrawer),
    availableIlsForFx: money(calc.availableIlsForFx),
    turkeyExpectedUsd: money(calc.turkey.expectedUsd),
    turkeyDebtUsd: money(turkeyBalance.usd.closingBalance),
    turkeyDebtStatus: turkeyBalance.usd.closingBalance > 0.005 ? "debt" : "ok",
    turkeyBalanceClosingUsd: money(turkeyBalance.usd.closingBalance),
    turkeyBalanceStatus: turkeyBalance.usd.status,
  };
}

export function dec(v: number | string | null | undefined): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  try {
    const d = new Prisma.Decimal(typeof v === "number" ? v : String(v).replace(",", "."));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}
