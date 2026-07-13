/**
 * DTO לטבלת חישובים ויתרות — חישובים מ-flow-calculation-service בלבד.
 */

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyStatusKind } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  computeFlowWeekVariance,
  flowDisplayDiff,
  getFlowWeekVarianceLines,
} from "@/lib/flow-control/services/flow-variance.service";
import type { CashVarianceLineDto } from "@/lib/cash-control-variance";

export type FlowCalculationTableRow = {
  drawerUsd: string;
  drawerIls: string;
  turkeyBalanceUsd: string;
  bankBalanceIls: string;
  expensesIls: string;
  expensesUsd: string;
  expectedNetUsd: string;
  expectedNetIls: string;
  countedUsd: string | null;
  countedIls: string | null;
  diffUsd: string | null;
  diffIls: string | null;
  fxProfitIls: string;
  fxLossIls: string;
  fxNetIls: string;
  status: CashDailyStatusKind;
  varianceLines: CashVarianceLineDto[];
};

function fmt(n: number): string {
  return n.toFixed(2);
}

function cashLine(lines: CashVarianceLineDto[], method: "CASH_USD" | "CASH_ILS") {
  return lines.find((l) => l.method === method);
}

function sumIntakeFxPl(flow: FlowWeekDrillPayload["flow"]): { profitIls: number; lossIls: number; netIls: number } {
  let profitIls = 0;
  let lossIls = 0;
  for (const p of flow.fxPurchases) {
    if (p.intakeProfitIls != null || p.intakeLossIls != null) {
      profitIls += p.intakeProfitIls ?? 0;
      lossIls += p.intakeLossIls ?? 0;
      continue;
    }
    for (const line of p.intakeAllocations ?? []) {
      if (line.profitIls > 0.005) profitIls += line.profitIls;
      else if (line.profitIls < -0.005) lossIls += Math.abs(line.profitIls);
    }
  }
  const netIls = Math.round((profitIls - lossIls) * 100) / 100;
  return {
    profitIls: Math.round(profitIls * 100) / 100,
    lossIls: Math.round(lossIls * 100) / 100,
    netIls,
  };
}

export function buildFlowCalculationTableRow(drill: FlowWeekDrillPayload): FlowCalculationTableRow {
  const { flow } = drill;
  const variance = computeFlowWeekVariance(drill);
  const lines = getFlowWeekVarianceLines(drill);
  const usdLine = cashLine(lines, "CASH_USD");
  const ilsLine = cashLine(lines, "CASH_ILS");
  const intakePl = sumIntakeFxPl(flow);

  const diffUsd = usdLine ? flowDisplayDiff(usdLine) : null;
  const diffIls = ilsLine ? flowDisplayDiff(ilsLine) : null;

  return {
    drawerUsd: flow.drawerRemainingUsd,
    drawerIls: flow.drawerRemainingIls,
    turkeyBalanceUsd: flow.turkeyBalanceClosingUsd,
    bankBalanceIls: flow.bankBalanceIls ?? "0",
    expensesIls: flow.expensesIls,
    expensesUsd: flow.expensesUsd,
    expectedNetUsd: usdLine ? fmt(usdLine.expectedNet) : "0.00",
    expectedNetIls: ilsLine ? fmt(ilsLine.expectedNet) : "0.00",
    countedUsd: flow.counted.CASH_USD ?? null,
    countedIls: flow.counted.CASH_ILS ?? null,
    diffUsd: diffUsd != null ? fmt(diffUsd) : null,
    diffIls: diffIls != null ? fmt(diffIls) : null,
    fxProfitIls: fmt(intakePl.profitIls > 0 ? intakePl.profitIls : fcNum(flow.kpis.fxProfitIls)),
    fxLossIls: fmt(intakePl.lossIls > 0 ? intakePl.lossIls : fcNum(flow.kpis.fxLossIls)),
    fxNetIls: fmt(intakePl.netIls || fcNum(flow.kpis.fxProfitIls) - fcNum(flow.kpis.fxLossIls)),
    status: variance.status,
    varianceLines: lines,
  };
}
