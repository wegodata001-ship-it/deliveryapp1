/**
 * FX Purchase — SSOT balance from approved cash control (CashWeekFlow) only.
 */

import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import type { CashControlSnapshot } from "@/lib/flow-control/fx-purchase/types";
import {
  snapshotFromCashWeekFlowRow,
} from "@/lib/flow-control/fx-purchase/balance.shared";

export {
  computeFxAvailableBalances,
  availableIlsForTrack,
  snapshotFromCashWeekFlowRow,
  buildBalanceSourceAudit,
  evaluateFxPurchaseGate,
} from "@/lib/flow-control/fx-purchase/balance.shared";

type PrismaTx = Prisma.TransactionClient;

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

export async function loadFxPurchases(weekCode: string): Promise<FxPurchaseRecord[]> {
  const snapshot = await loadCashControlSnapshot(weekCode);
  return snapshot.fxPurchases;
}
