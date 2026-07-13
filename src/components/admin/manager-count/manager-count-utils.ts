import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import {
  computeTurkeyExpectedUsd,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import { fcNum } from "@/components/admin/flow-control/shared";

export function formFromFlow(flow: FlowWeekPayload): ManagerCountForm {
  return {
    countedCashUsd: flow.counted.CASH_USD ?? "",
    countedCashIls: flow.counted.CASH_ILS ?? "",
    countedChecksIls: flow.counted.CHECK ?? "",
    countedCreditIls: flow.counted.CREDIT ?? "",
    countedTransferIls: flow.counted.BANK_TRANSFER ?? "",
    commissionUsd: flow.commissionUsd ?? "",
    commissionIls: flow.commissionIls ?? "",
    turkeyTransferUsd: flow.turkeyTransferUsd ?? "",
  };
}

export function computeAutoTurkeyUsd(form: ManagerCountForm, fxUsdTotal: number): number {
  return computeTurkeyExpectedUsd(
    fcNum(form.countedCashUsd),
    fxUsdTotal,
    fcNum(form.commissionUsd),
  );
}

export function isTurkeyManual(form: ManagerCountForm, flow: FlowWeekPayload | null): boolean {
  if (!flow) return false;
  const fxUsd = sumFxPurchases(flow.fxPurchases).usd;
  const auto = computeAutoTurkeyUsd(form, fxUsd);
  const stored = fcNum(form.turkeyTransferUsd);
  return Math.abs(stored - auto) > 0.02;
}

export function syncAutoTurkey(form: ManagerCountForm, flow: FlowWeekPayload | null): ManagerCountForm {
  if (!flow) return form;
  const fxUsd = sumFxPurchases(flow.fxPurchases).usd;
  const auto = computeAutoTurkeyUsd(form, fxUsd);
  return { ...form, turkeyTransferUsd: auto > 0 ? auto.toFixed(2) : "" };
}

export function sumIntakeFxPlFromPurchases(flow: FlowWeekPayload | null): {
  profitIls: number;
  lossIls: number;
  netIls: number;
} {
  if (!flow) return { profitIls: 0, lossIls: 0, netIls: 0 };
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
