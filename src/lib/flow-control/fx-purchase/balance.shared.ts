import type { FxPurchaseRecord, FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import {
  computeIlAvailableIlsForFx,
  computePsAvailableIlsForFx,
  parseFxPurchasesJson,
  sumFxPurchases,
  sumFxRemainderToBankIls,
  sumIlReturnedToMainCashIls,
} from "@/lib/flow-control/flow-calculation-service";
import type {
  CashControlSnapshot,
  FxAvailableBalances,
  FxPurchaseGateResult,
} from "@/lib/flow-control/fx-purchase/types";

function decimalNumber(value: { toString(): string } | null | undefined): number {
  const parsed = Number(value?.toString() ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatIls(amount: number): string {
  return `₪${amount.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function computeFxAvailableBalances(
  snapshot: CashControlSnapshot,
): FxAvailableBalances {
  return {
    psCash: computePsAvailableIlsForFx(snapshot.countedCashIls, snapshot.fxPurchases),
    ilTransfers: computeIlAvailableIlsForFx(
      snapshot.countedTransferIls,
      snapshot.countedCreditIls,
      snapshot.countedChecksIls,
      snapshot.fxPurchases,
    ),
  };
}

export function availableIlsForTrack(
  balances: FxAvailableBalances,
  track: FxPurchaseTrack,
): number {
  return track === "PS" ? balances.psCash : balances.ilTransfers;
}

export function snapshotFromCashWeekFlowRow(
  weekCode: string,
  row: {
    countedCashIls: { toString(): string } | null;
    countedCashUsd: { toString(): string } | null;
    countedTransferIls: { toString(): string } | null;
    countedCreditIls: { toString(): string } | null;
    countedChecksIls: { toString(): string } | null;
    commissionUsd: { toString(): string } | null;
    commissionIls: { toString(): string } | null;
    fxPurchases: unknown;
  } | null,
): CashControlSnapshot {
  return {
    weekCode: weekCode.trim(),
    countedCashIls: decimalNumber(row?.countedCashIls),
    countedCashUsd: decimalNumber(row?.countedCashUsd),
    countedTransferIls: decimalNumber(row?.countedTransferIls),
    countedCreditIls: decimalNumber(row?.countedCreditIls),
    countedChecksIls: decimalNumber(row?.countedChecksIls),
    commissionUsd: decimalNumber(row?.commissionUsd),
    commissionIls: decimalNumber(row?.commissionIls),
    fxPurchases: parseFxPurchasesJson(row?.fxPurchases),
  };
}

export function buildBalanceSourceAudit(snapshot: CashControlSnapshot) {
  const psPurchasesIls = sumFxPurchases(snapshot.fxPurchases, "PS").ils;
  const ilPurchasesIls = sumFxPurchases(snapshot.fxPurchases, "IL").ils;
  const ilToBankIls = sumIlReturnedToMainCashIls(snapshot.fxPurchases);
  const pool =
    snapshot.countedTransferIls + snapshot.countedCreditIls + snapshot.countedChecksIls;
  const psToBank = sumFxRemainderToBankIls(snapshot.fxPurchases, "PS");

  return {
    countedCashIls: snapshot.countedCashIls,
    countedTransferIls: snapshot.countedTransferIls,
    countedCreditIls: snapshot.countedCreditIls,
    countedChecksIls: snapshot.countedChecksIls,
    psPurchasesIls,
    ilPurchasesIls,
    ilReturnedToMainCashIls: ilToBankIls,
    psCalculation: `max(0, CashWeekFlow.countedCashIls(${snapshot.countedCashIls.toFixed(2)}) - psPurchases(${psPurchasesIls.toFixed(2)}) - psToBank(${psToBank.toFixed(2)}))`,
    ilCalculation: `max(0, pool(${pool.toFixed(2)}) - ilPurchases(${ilPurchasesIls.toFixed(2)}) - ilToBank(${ilToBankIls.toFixed(2)}))`,
  };
}

/** Single validation gate — Requested ≤ Available (0 = ללא רכישה, תקין) */
export function evaluateFxPurchaseGate(
  availableIls: number,
  requestedIls: number,
): FxPurchaseGateResult {
  if (!Number.isFinite(requestedIls) || requestedIls < -0.02) {
    return {
      ok: false,
      shortfall: 0,
      availableIls,
      requiredIls: 0,
      error: "סכום רכישה לא תקין",
    };
  }
  if (requestedIls <= 0.005) {
    return {
      ok: true,
      shortfall: 0,
      availableIls,
      requiredIls: 0,
    };
  }
  const shortfall = Math.max(0, Math.round((requestedIls - availableIls) * 100) / 100);
  if (shortfall > 0.02) {
    return {
      ok: false,
      shortfall,
      availableIls,
      requiredIls: requestedIls,
      error: `קיים:\n${formatIls(availableIls)}\n\nנדרש:\n${formatIls(requestedIls)}\n\nחסר:\n${formatIls(shortfall)}`,
    };
  }
  return {
    ok: true,
    shortfall: 0,
    availableIls,
    requiredIls: requestedIls,
  };
}
