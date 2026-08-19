import type { FlowWeekPayload, ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import {
  initializeManagerCountFormFields,
  hasSavedManagerCount,
  managerCountLineStatus,
  MANAGER_COUNT_LINE_IDS,
  type ManagerCountExpectedLine,
} from "@/lib/flow-control/services/manager-count-expected-service";
import {
  computeTurkeyAllocationFromCashCount,
  computeTurkeyIlAllocationIls,
  sumFxPurchases,
} from "@/lib/flow-control/flow-calculation-service";
import {
  computeFxAvailableBalances,
} from "@/lib/flow-control/fx-purchase/balance.shared";
import type { CashControlSnapshot } from "@/lib/flow-control/fx-purchase/types";
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

/** טופס ראשוני — ממלא מצפוי קליטה כשאין ספירה שמורה */
export function initializeManagerCountForm(flow: FlowWeekPayload): ManagerCountForm {
  const base = formFromFlow(flow);
  const lines = flow.managerCountExpected ?? [];
  const expected = Object.fromEntries(
    lines.map((l) => [l.lineId, l.expectedAmount] as const),
  ) as Partial<Record<(typeof MANAGER_COUNT_LINE_IDS)[number], number>>;
  const prefill = initializeManagerCountFormFields(flow.counted, expected as Record<
    import("@/lib/cash-control-week-flow").CashWeekFlowLineId,
    number
  >);
  return { ...base, ...prefill };
}

export { hasSavedManagerCount, managerCountLineStatus };
export type { ManagerCountExpectedLine };

function snapshotFromFlow(
  flow: FlowWeekPayload,
  form?: Partial<
    Pick<
      ManagerCountForm,
      "countedCashIls" | "countedTransferIls" | "countedCreditIls" | "countedChecksIls"
    >
  > | null,
): CashControlSnapshot {
  return {
    weekCode: flow.week,
    countedCashIls: form ? fcNum(form.countedCashIls) : fcNum(flow.counted.CASH_ILS),
    countedCashUsd: fcNum(flow.counted.CASH_USD),
    countedTransferIls: form ? fcNum(form.countedTransferIls) : fcNum(flow.counted.BANK_TRANSFER),
    countedCreditIls: form ? fcNum(form.countedCreditIls) : fcNum(flow.counted.CREDIT),
    countedChecksIls: form ? fcNum(form.countedChecksIls) : fcNum(flow.counted.CHECK),
    commissionUsd: fcNum(flow.commissionUsd),
    commissionIls: fcNum(flow.commissionIls),
    fxPurchases: flow.fxPurchases,
  };
}

/** זמין לרכישת מט״ח PS — SSOT formulas, display only */
export function resolveAvailablePsIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<ManagerCountForm, "countedCashIls"> | null,
): string {
  if (!flow) return "0.00";
  return computeFxAvailableBalances(snapshotFromFlow(flow, form)).psCash.toFixed(2);
}

/** זמין לרכישת מט״ח IL — SSOT formulas, display only */
export function resolveAvailableIlIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<
    ManagerCountForm,
    "countedTransferIls" | "countedCreditIls" | "countedChecksIls"
  > | null,
): string {
  if (!flow) return "0.00";
  return computeFxAvailableBalances(snapshotFromFlow(flow, form)).ilTransfers.toFixed(2);
}

/** @deprecated — use resolveAvailablePsIlsForFx */
export function resolveAvailableIlsForFx(
  flow: FlowWeekPayload | null,
  form?: Pick<ManagerCountForm, "countedCashIls"> | null,
): string {
  return resolveAvailablePsIlsForFx(flow, form);
}

export function computeAutoTurkeyUsd(form: ManagerCountForm, fxPsUsd: number): number {
  return computeTurkeyAllocationFromCashCount(fcNum(form.countedCashUsd), fxPsUsd);
}

export function computeAutoTurkeyIls(_form: ManagerCountForm, fxIlIls: number): number {
  return computeTurkeyIlAllocationIls(fxIlIls);
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
  return (
    fcNum(form.countedTransferIls) + fcNum(form.countedCreditIls) + fcNum(form.countedChecksIls)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** תצוגה/ולידציה — שלב רכישת מט״ח בספירת מנהל */
export function computeFxPurchaseFormPreview(
  availableIlsBefore: number,
  purchaseIls: number,
  rate: number,
): {
  availableIlsBefore: number;
  purchaseIls: number;
  rate: number;
  purchasedUsd: number;
  remainingIlsAfter: number;
} {
  const available = round2(availableIlsBefore);
  const purchase = round2(Math.max(0, purchaseIls));
  const remainingIlsAfter = round2(available - purchase);
  const purchasedUsd =
    purchase > 0.005 && rate > 0.005 ? round2(purchase / rate) : 0;
  return {
    availableIlsBefore: available,
    purchaseIls: purchase,
    rate: round2(rate),
    purchasedUsd,
    remainingIlsAfter,
  };
}

export const FX_PURCHASE_OVER_LIMIT_ERROR =
  "לא ניתן לרכוש סכום גבוה מהיתרה הזמינה בקופה";

export const FX_PURCHASE_RATE_REQUIRED_ERROR = "יש להזין שער רכישה";

export const FX_PURCHASE_AMOUNT_REQUIRED_ERROR =
  "יש להזין סכום ₪ (0 = ללא רכישת מט״ח)";

/** ולידציה חיה — תמיד מחושבת מערכי הטופס הנוכחיים (לא מ-state ישן). */
export function validateFxPurchaseFormInput(params: {
  trimmedIls: string;
  ilsNum: number;
  rateNum: number;
  availNum: number;
  isZeroPurchase: boolean;
  isNegativePurchase: boolean;
}): string | null {
  const { trimmedIls, ilsNum, rateNum, availNum, isZeroPurchase, isNegativePurchase } = params;
  if (trimmedIls === "") return null;
  if (isNegativePurchase) return "סכום רכישה לא יכול להיות שלילי";
  if (ilsNum > availNum + 0.02) return FX_PURCHASE_OVER_LIMIT_ERROR;
  if (!isZeroPurchase && !(Number.isFinite(rateNum) && rateNum > 0)) {
    return FX_PURCHASE_RATE_REQUIRED_ERROR;
  }
  return null;
}
