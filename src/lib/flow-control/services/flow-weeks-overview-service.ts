/**
 * FlowWeeksOverviewService — סיכום שבועי לבקרת תזרים.
 * מקור: בקרת קופה בלבד (CashDailyDrawerCount + CashWeekFlow + CashExpense).
 * אין קריאה ל-Payment.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { loadFlowWeekCashCountSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function loadOneWeekOverview(weekCode: string): Promise<FlowWeekOverviewRow | null> {
  const wk = weekCode.trim();
  const [approved, flow] = await Promise.all([
    loadFlowWeekCashCountSummary(wk),
    loadFlowWeek(wk),
  ]);
  if (!flow) return null;

  const drawer = { ...emptyDailyIntake() };
  for (const id of ["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[]) {
    drawer[id] = approved.approved[id]?.amount ?? 0;
  }
  // OTHER — רק מספירות יומיות
  let otherTotal = 0;
  let maxDays = 0;
  for (const line of Object.values(approved.approved)) {
    if (line.daysCounted > maxDays) maxDays = line.daysCounted;
  }

  const drawerRows = await prisma.cashDailyDrawerCount.findMany({
    where: { weekCode: wk, countryCode: "TR" },
    select: { otherIls: true },
  });
  for (const r of drawerRows) {
    otherTotal += Number(r.otherIls?.toString() ?? 0);
  }

  const drawerDto = Object.fromEntries(
    (Object.keys(drawer) as CashDailyMethodId[]).map((k) => [k, money(drawer[k])]),
  ) as Record<CashDailyMethodId, string>;
  drawerDto.OTHER = money(otherTotal);

  const lastFx = flow.fxPurchases.length > 0 ? flow.fxPurchases[flow.fxPurchases.length - 1] : null;

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    hasData: approved.hasAnyCount || flow.counted.CASH_ILS != null,
    drawer: drawerDto,
    totalReceivedIls: money(approved.totalApprovedIls + otherTotal),
    daysCounted: maxDays,
    manager: flow.counted,
    commissionUsd: flow.commissionUsd,
    commissionIls: flow.commissionIls,
    turkeyTransferUsd: flow.turkeyTransferUsd,
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
