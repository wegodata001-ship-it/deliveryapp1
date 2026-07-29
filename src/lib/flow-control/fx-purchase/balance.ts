/**
 * FX Purchase — SSOT balance from approved cash control (CashWeekFlow) only.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FxPurchaseRecord, FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import {
  computeIlAvailableIlsForFx,
  computePsAvailableIlsForFx,
  parseFxPurchasesJson,
  sumFxPurchases,
  sumIlReturnedToMainCashIls,
} from "@/lib/flow-control/flow-calculation-service";
import type {
  CashControlSnapshot,
  FxAvailableBalances,
  FxPurchaseGateResult,
} from "@/lib/flow-control/fx-purchase/types";

type PrismaTx = Prisma.TransactionClient;

function decimalNumber(value: Prisma.Decimal | null | undefined): number {
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
    countedCashIls: Prisma.Decimal | null;
    countedCashUsd: Prisma.Decimal | null;
    countedTransferIls: Prisma.Decimal | null;
    countedCreditIls: Prisma.Decimal | null;
    countedChecksIls: Prisma.Decimal | null;
    commissionUsd: Prisma.Decimal | null;
    commissionIls: Prisma.Decimal | null;
    fxPurchases: Prisma.JsonValue | null;
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

export async function loadCashControlSnapshot(
  weekCode: string,
  tx: PrismaTx = prisma,
): Promise<CashControlSnapshot> {
  const wk = weekCode.trim();
  const row = await tx.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
  });
  return snapshotFromCashWeekFlowRow(wk, row);
}

export function buildBalanceSourceAudit(snapshot: CashControlSnapshot) {
  const psPurchasesIls = sumFxPurchases(snapshot.fxPurchases, "PS").ils;
  const ilPurchasesIls = sumFxPurchases(snapshot.fxPurchases, "IL").ils;
  const ilReturnedToMainCashIls = sumIlReturnedToMainCashIls(snapshot.fxPurchases);
  const pool =
    snapshot.countedTransferIls + snapshot.countedCreditIls + snapshot.countedChecksIls;

  return {
    countedCashIls: snapshot.countedCashIls,
    countedTransferIls: snapshot.countedTransferIls,
    countedCreditIls: snapshot.countedCreditIls,
    countedChecksIls: snapshot.countedChecksIls,
    psPurchasesIls,
    ilPurchasesIls,
    ilReturnedToMainCashIls,
    psCalculation: `max(0, CashWeekFlow.countedCashIls(${snapshot.countedCashIls.toFixed(2)}) + ilReturned(${ilReturnedToMainCashIls.toFixed(2)}) - psPurchases(${psPurchasesIls.toFixed(2)}))`,
    ilCalculation: `max(0, pool(${pool.toFixed(2)}) - ilPurchases(${ilPurchasesIls.toFixed(2)}) - ilReturned(${ilReturnedToMainCashIls.toFixed(2)}))`,
  };
}

/** Single validation gate — Requested ≤ Available */
export function evaluateFxPurchaseGate(
  availableIls: number,
  requestedIls: number,
): FxPurchaseGateResult {
  if (!Number.isFinite(requestedIls) || requestedIls <= 0) {
    return {
      ok: false,
      shortfall: 0,
      availableIls,
      requiredIls: 0,
      error: "סכום רכישה חייב להיות חיובי",
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

export async function loadFxPurchases(weekCode: string): Promise<FxPurchaseRecord[]> {
  const snapshot = await loadCashControlSnapshot(weekCode);
  return snapshot.fxPurchases;
}
