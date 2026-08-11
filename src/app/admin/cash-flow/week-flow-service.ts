import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { countLineDiff, WEEK_FLOW_LINE_CHANNEL, type CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { aggregateExpensesByMethod } from "@/lib/cash-expense-payment-method";
import { formatAhWeekLabel, getAhWeekRange } from "@/lib/weeks/ah-week";
import { emptyDailyIntake, paymentDayKeyJerusalem } from "@/lib/cash-control-daily";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import {
  aggregateFlowIntakesByDay,
  computeBankReceiptsIlsFromIntake,
  computeFlowWeekKpis,
  computeFlowWeekSummary,
  computeIlsChannelReceiptsFromIntake,
  computePaymentsTotalReceivedIls,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import {
  computeFxAvailableBalances,
  snapshotFromCashWeekFlowRow,
} from "@/lib/flow-control/fx-purchase/balance";
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
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import { mergePaymentWhere, resolveCountryScopeFromCode, cashExpenseWhereForCountryScope } from "@/lib/country-data-scope";

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

export async function loadFlowWeek(
  week: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowWeekPayload | null> {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;
  const countryScope = resolveCountryScopeFromCode(workCountry);

  const [approvedSummary, cashCount, fxPurchases, turkeyAllocationUsd, bankTx, turkeyBalance, expenseRows, payments] =
    await Promise.all([
      loadFlowWeekCashCountSummary(wk, workCountry),
      loadFlowWeekCashCount(wk, workCountry),
      loadFlowWeekFxPurchases(wk),
      loadFlowWeekTurkeyTransfer(wk),
      loadFlowWeekBankTransactions(wk),
      loadTurkeyBalanceForWeek(wk, workCountry),
      prisma.cashExpense.findMany({
        where: { ...cashExpenseWhereForCountryScope(countryScope), weekCode: wk, status: "ACTIVE" },
        select: { currency: true, amount: true, paymentMethod: true },
      }),
      prisma.payment.findMany({
        where: mergePaymentWhere(cashControlWeekReconciliationPaymentsWhere(wk), countryScope),
        select: {
          id: true,
          paymentCode: true,
          amountIls: true,
          amountUsd: true,
          paymentMethod: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          exchangeRate: true,
          methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
          amountWithoutVat: true,
          totalIlsWithoutVat: true,
          totalIlsWithVat: true,
          intakeDate: true,
          paymentDate: true,
          createdAt: true,
        },
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

  const intakeByDay = aggregateFlowIntakesByDay(payments, paymentDayKeyJerusalem);
  const weekIntake = emptyDailyIntake();
  for (const totals of intakeByDay.values()) {
    for (const k of Object.keys(weekIntake) as (keyof typeof weekIntake)[]) {
      weekIntake[k] = Math.round((weekIntake[k] + totals[k]) * 100) / 100;
    }
  }
  /** KPI «סה״כ התקבל» — קליטות תשלום בלבד (כל האמצעים, $ מומר ל־₪) */
  const totalReceivedIls = computePaymentsTotalReceivedIls(payments);
  /** תקבולי ₪ לערוצי שקל — לחישוב שקל זמין לרכישת מט״ח */
  const totalReceiptsIls = computeIlsChannelReceiptsFromIntake(weekIntake);
  const bankReceiptsIls = computeBankReceiptsIlsFromIntake(weekIntake);

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

  const fxPs = sumFxPurchases(fxPurchases, "PS");
  const fxIl = sumFxPurchases(fxPurchases, "IL");
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
    countedTransferIls: cashCount.countedTransferIls ?? 0,
    countedCreditIls: cashCount.countedCreditIls ?? 0,
    countedChecksIls: cashCount.countedChecksIls ?? 0,
    totalReceiptsIls,
    bankReceiptsIls,
  });

  const fxBalances = computeFxAvailableBalances(
    snapshotFromCashWeekFlowRow(wk, {
      countedCashIls: new Prisma.Decimal(managerCashIls),
      countedCashUsd: new Prisma.Decimal(managerCashUsd),
      countedTransferIls: new Prisma.Decimal(cashCount.countedTransferIls ?? 0),
      countedCreditIls: new Prisma.Decimal(cashCount.countedCreditIls ?? 0),
      countedChecksIls: new Prisma.Decimal(cashCount.countedChecksIls ?? 0),
      commissionUsd: new Prisma.Decimal(cashCount.commissionUsd),
      commissionIls: new Prisma.Decimal(cashCount.commissionIls),
      fxPurchases: fxPurchases as unknown as Prisma.JsonValue,
    }),
  );

  const kpis = computeFlowWeekKpis({
    totalReceivedIls,
    fxTotals: calc.fxTotals,
    turkeyTransferUsd: actualTurkeyTransfersUsd,
    cashIlsInDrawer: calc.cashIlsInDrawer,
    cashUsdInDrawer: calc.cashUsdInDrawer,
    bankBalanceIls: calc.bankBalanceIls,
    fxProfitLoss: calc.fxProfitLoss,
  });

  const lastPsFx = fxPurchases.filter((p) => p.track !== "IL").at(-1) ?? null;
  const storedTurkeyUsd = cashCount.turkeyTransferUsd ?? turkeyAllocationUsd;
  const storedTurkeyIls = cashCount.turkeyTransferIls ?? 0;

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
    fxPurchaseIls: fxPs.ils > 0 ? money(fxPs.ils) : null,
    fxPurchaseUsd: fxPs.usd > 0 ? money(fxPs.usd) : null,
    fxRemainderCashIls: lastPsFx ? money(lastPsFx.remainderCashIls) : null,
    fxRemainderBankIls: lastPsFx ? money(lastPsFx.remainderBankIls) : null,
    fxPurchases,
    fxProfitLoss: calc.fxProfitLoss,
    fxProfitLossHistory: calc.fxProfitLossHistory,
    kpis,
    turkey: calc.turkey,
    turkeyBalance,
    turkeyTransferUsd: storedTurkeyUsd > 0 ? money(storedTurkeyUsd) : null,
    turkeyTransferIls: storedTurkeyIls > 0 ? money(storedTurkeyIls) : null,
    bankBalanceIls: money(calc.bankBalanceIls),
    bankBalanceUsd: null,
    drawerRemainingIls: money(calc.cashIlsInDrawer),
    drawerRemainingUsd: money(calc.cashUsdInDrawer),
    availableIlsForFx: money(fxBalances.psCash),
    availableIlIlsForFx: money(fxBalances.ilTransfers),
    turkeyExpectedUsd: money(calc.turkey.expectedUsd),
    turkeyDebtUsd: money(turkeyBalance.usd.closingBalance),
    turkeyDebtStatus: turkeyBalance.usd.closingBalance > 0.005 ? "debt" : "ok",
    turkeyBalanceClosingUsd: money(turkeyBalance.usd.closingBalance),
    turkeyBalanceStatus: turkeyBalance.usd.status,
    ilFxPurchaseIls: money(fxIl.ils),
    ilsRemainingAfterFx: money(calc.ilsRemainingAfterFx),
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
