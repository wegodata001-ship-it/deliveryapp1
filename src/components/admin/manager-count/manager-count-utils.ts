import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import {
  computeIlAvailableIlsForFx,
  computeIlSourcePoolIls,
  computePsAvailableIlsForFx,
  computeTurkeyAllocationFromCashCount,
  computeTurkeyIlAllocationIls,
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
    turkeyTransferIls: flow.turkeyTransferIls ?? "",
  };
}

/** זמין לרכישת מט״ח PS — מזומן ₪ PS בלבד */
export function resolveAvailablePsIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<ManagerCountForm, "countedCashIls"> | null,
): string {
  if (!flow) return "0.00";
  const cashIls = form ? fcNum(form.countedCashIls) : fcNum(flow.counted.CASH_ILS);
  return computePsAvailableIlsForFx(cashIls, flow.fxPurchases).toFixed(2);
}

/** זמין לרכישת מט״ח IL — מאגר בנקאי IL בלבד */
export function resolveAvailableIlIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<
    ManagerCountForm,
    "countedTransferIls" | "countedCreditIls" | "countedChecksIls"
  > | null,
): string {
  if (!flow) return "0.00";
  const transfer = form ? fcNum(form.countedTransferIls) : fcNum(flow.counted.BANK_TRANSFER);
  const credit = form ? fcNum(form.countedCreditIls) : fcNum(flow.counted.CREDIT);
  const checks = form ? fcNum(form.countedChecksIls) : fcNum(flow.counted.CHECK);
  return computeIlAvailableIlsForFx(transfer, credit, checks, flow.fxPurchases).toFixed(2);
}

/**
 * @deprecated איחוד PS+IL אסור. העדף resolveAvailablePsIlsForFx.
 */
export function resolveAvailableIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<ManagerCountForm, "countedCashIls"> | null,
): string {
  return resolveAvailablePsIlsForFx(flow, form);
}

export function computeAutoTurkeyUsd(form: ManagerCountForm, fxPsUsd: number): number {
  return computeTurkeyAllocationFromCashCount(
    fcNum(form.countedCashUsd),
    fxPsUsd,
    fcNum(form.commissionUsd),
  );
}

export function computeAutoTurkeyIls(form: ManagerCountForm, fxIlIls: number): number {
  return computeTurkeyIlAllocationIls(fxIlIls, fcNum(form.commissionIls));
}

export function isTurkeyManual(form: ManagerCountForm, flow: FlowWeekPayload | null): boolean {
  if (!flow) return false;
  const fxPsUsd = sumFxPurchases(flow.fxPurchases, "PS").usd;
  const auto = computeAutoTurkeyUsd(form, fxPsUsd);
  const stored = fcNum(form.turkeyTransferUsd);
  return Math.abs(stored - auto) > 0.02;
}

export function isTurkeyIlManual(form: ManagerCountForm, flow: FlowWeekPayload | null): boolean {
  if (!flow) return false;
  const fxIlIls = sumFxPurchases(flow.fxPurchases, "IL").ils;
  const auto = computeAutoTurkeyIls(form, fxIlIls);
  const stored = fcNum(form.turkeyTransferIls);
  return Math.abs(stored - auto) > 0.02;
}

export function syncAutoTurkey(form: ManagerCountForm, flow: FlowWeekPayload | null): ManagerCountForm {
  if (!flow) return form;
  const fxPsUsd = sumFxPurchases(flow.fxPurchases, "PS").usd;
  const fxIlIls = sumFxPurchases(flow.fxPurchases, "IL").ils;
  const autoPs = computeAutoTurkeyUsd(form, fxPsUsd);
  const autoIl = computeAutoTurkeyIls(form, fxIlIls);
  return {
    ...form,
    turkeyTransferUsd: autoPs > 0 ? autoPs.toFixed(2) : "",
    turkeyTransferIls: autoIl > 0 ? autoIl.toFixed(2) : "",
  };
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
    profitIls += p.intakeProfitIls ?? 0;
    lossIls += p.intakeLossIls ?? 0;
  }
  return { profitIls, lossIls, netIls: profitIls - lossIls };
}

export function ilSourcePoolFromForm(form: ManagerCountForm): number {
  return computeIlSourcePoolIls(
    fcNum(form.countedTransferIls),
    fcNum(form.countedCreditIls),
    fcNum(form.countedChecksIls),
  );
}
