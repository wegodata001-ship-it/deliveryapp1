/**
 * FlowWeeksOverviewService — סיכום שבועי לבקרת תזרים.
 * תקבולים: Payment לפי תאריך ביצוע קליטה (intakeDate).
 * ספירת מנהל / מט״ח / טורקיה: CashWeekFlow.
 */

import { prisma } from "@/lib/prisma";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import { allCashControlChannels, CHANNEL_DRAWER_FIELD } from "@/lib/cash-control-channel";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { buildFlowPaymentDailyRows } from "@/lib/flow-control/services/cashflow-received-table.service";
import { loadTurkeyBalanceForWeek } from "@/lib/flow-control/turkey-transfer-balance-service";
import { loadFlowWeekCashCountSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadOneWeekOverview(weekCode: string): Promise<FlowWeekOverviewRow | null> {
  const wk = weekCode.trim();
  const [approved, flow, drawerRows, turkeyBalance, payments] = await Promise.all([
    loadFlowWeekCashCountSummary(wk),
    loadFlowWeek(wk),
    prisma.cashDailyDrawerCount.findMany({
      where: { weekCode: wk, countryCode: "TR" },
    }),
    loadTurkeyBalanceForWeek(wk),
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        exchangeRate: true,
        amountWithoutVat: true,
        totalIlsWithoutVat: true,
        totalIlsWithVat: true,
        methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
        intakeDate: true,
        paymentDate: true,
        createdAt: true,
      },
    }),
  ]);
  if (!flow) return null;

  const paymentDaily = buildFlowPaymentDailyRows(wk, payments);
  const paymentTotalRow = paymentDaily.find((r) => r.isTotal);
  const totalReceivedIls = paymentTotalRow?.totalReceived ?? money(0);

  const drawerTotals = emptyDailyIntake();
  for (const row of drawerRows) {
    for (const channel of allCashControlChannels()) {
      const field = CHANNEL_DRAWER_FIELD[channel];
      const raw = row[field as keyof typeof row];
      if (raw == null) continue;
      const v = Number(raw.toString());
      if (!Number.isFinite(v)) continue;
      drawerTotals[channel] = round2(drawerTotals[channel] + v);
    }
  }

  const drawerDto = Object.fromEntries(
    allCashControlChannels().map((k) => [k, money(drawerTotals[k])]),
  ) as Record<CashDailyMethodId, string>;

  let maxDays = 0;
  for (const line of Object.values(approved.approved)) {
    if (line.daysCounted > maxDays) maxDays = line.daysCounted;
  }

  const lastFx = flow.fxPurchases.length > 0 ? flow.fxPurchases[flow.fxPurchases.length - 1] : null;
  const hasPaymentData = paymentDaily.some((r) => !r.isTotal);

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    hasData: hasPaymentData || approved.hasAnyCount || flow.counted.CASH_ILS != null,
    drawer: drawerDto,
    totalReceivedIls,
    daysCounted: maxDays,
    manager: flow.counted,
    commissionUsd: flow.commissionUsd,
    commissionIls: flow.commissionIls,
    turkeyTransferUsd: flow.turkeyTransferUsd,
    turkeyOpeningUsd: money(turkeyBalance.usd.openingBalance),
    turkeyAddedUsd: money(turkeyBalance.usd.addedFromCashCount + turkeyBalance.usd.adjusted),
    turkeyTransferredUsd: money(turkeyBalance.usd.transferred - turkeyBalance.usd.reversed),
    turkeyClosingUsd: money(turkeyBalance.usd.closingBalance),
    turkeyBalanceStatus: turkeyBalance.usd.status,
    fxPurchaseIls: flow.fxPurchaseIls,
    fxPurchaseUsd: flow.fxPurchaseUsd,
    fxRemainderCashIls: lastFx ? money(lastFx.remainderCashIls) : flow.fxRemainderCashIls,
    fxRemainderBankIls: lastFx ? money(lastFx.remainderBankIls) : flow.fxRemainderBankIls,
    fxPurchaseCount: flow.fxPurchases.length,
    expensesIls: flow.expensesIls,
    expensesUsd: flow.expensesUsd,
    drawerRemainingIls: flow.drawerRemainingIls,
    drawerRemainingUsd: flow.drawerRemainingUsd,
    bankBalanceIls: flow.bankBalanceIls,
    fxProfitIls: flow.kpis.fxProfitIls,
    fxLossIls: flow.kpis.fxLossIls,
  };
}

export async function loadFlowWeeksOverview(weekCodes: string[]): Promise<FlowWeekOverviewRow[]> {
  const results = await Promise.all(weekCodes.map((w) => loadOneWeekOverview(w)));
  return results.filter((r): r is FlowWeekOverviewRow => r != null);
}
