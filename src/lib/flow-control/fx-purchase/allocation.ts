/**
 * FX Purchase — FIFO intake allocation (rebuilt, no legacy code).
 */

import { prisma } from "@/lib/prisma";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import {
  paymentAmountForDailyColumn,
  paymentDayKeyJerusalem,
  paymentMatchesDailyColumn,
} from "@/lib/cash-control-daily";
import type {
  FxPurchaseIntakeAllocation,
  FxPurchaseRecord,
  FxPurchaseTrack,
} from "@/app/admin/cash-flow/flow-types";
import type {
  CashControlSnapshot,
  FxAllocationPreview,
  FxIntakeReceipt,
} from "@/lib/flow-control/fx-purchase/types";
import { loadCashControlSnapshot } from "@/lib/flow-control/fx-purchase/balance";

type PrismaTx = import("@prisma/client").Prisma.TransactionClient;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const PS_COLUMNS = ["CASH_ILS"] as const;
const IL_COLUMNS = ["BANK_TRANSFER_ILS", "CREDIT_CARD_ILS", "CHECK_ILS"] as const;

function columnsForTrack(track: FxPurchaseTrack) {
  return track === "IL" ? IL_COLUMNS : PS_COLUMNS;
}

function consumedIlsByPayment(
  purchases: FxPurchaseRecord[],
  track: FxPurchaseTrack,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const purchase of purchases) {
    const purchaseTrack = purchase.track === "IL" ? "IL" : "PS";
    if (purchaseTrack !== track) continue;
    for (const line of purchase.intakeAllocations ?? []) {
      map.set(line.paymentId, round2((map.get(line.paymentId) ?? 0) + line.ilsAmount));
    }
  }
  return map;
}

export function computeIntakeLineFxPl(
  ilsAmount: number,
  intakeRate: number,
  purchaseRate: number,
): number {
  if (ilsAmount <= 0 || intakeRate <= 0 || purchaseRate <= 0) return 0;
  return round2((ilsAmount * (purchaseRate - intakeRate)) / purchaseRate);
}

export function buildIntakeReceipts(
  payments: Array<{
    id: string;
    paymentCode: string | null;
    orderId: string | null;
    intakeDate: Date | null;
    paymentDate: Date | null;
    createdAt: Date;
    exchangeRate: import("@prisma/client").Prisma.Decimal | null;
    paymentMethod: string | null;
    usdPaymentMethod: string | null;
    ilsPaymentMethod: string | null;
    amountIls: import("@prisma/client").Prisma.Decimal | null;
    amountUsd: import("@prisma/client").Prisma.Decimal | null;
    methodAllocations: Array<{
      method: string;
      currency: string;
      sourceAmount: import("@prisma/client").Prisma.Decimal;
    }>;
    customer: { displayName: string | null } | null;
    order: { orderNumber: string | null } | null;
  }>,
  snapshot: CashControlSnapshot,
  track: FxPurchaseTrack,
): FxIntakeReceipt[] {
  const consumed = consumedIlsByPayment(snapshot.fxPurchases, track);
  const columns = columnsForTrack(track);
  const receipts: FxIntakeReceipt[] = [];

  for (const payment of payments) {
    if (!columns.some((column) => paymentMatchesDailyColumn(payment, column))) continue;
    const gross = columns.reduce(
      (sum, column) => sum + paymentAmountForDailyColumn(payment, column),
      0,
    );
    const consumedIls = consumed.get(payment.id) ?? 0;
    const remainingIls = round2(gross - consumedIls);
    if (remainingIls <= 0.005) continue;

    const rate = Number(payment.exchangeRate?.toString() ?? 0);
    const when = new Date(payment.paymentDate ?? payment.createdAt);
    const orderNumber = payment.order?.orderNumber ?? null;

    receipts.push({
      paymentId: payment.id,
      orderId: payment.orderId ?? null,
      orderNumber,
      dateYmd: paymentDayKeyJerusalem(payment),
      dateLabel: when.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      sourceLabel: orderNumber ?? payment.paymentCode ?? payment.customer?.displayName ?? "תקבול",
      grossIls: round2(gross),
      consumedIls,
      remainingIls,
      intakeRate: rate > 0 ? rate : 0,
    });
  }

  return receipts;
}

/** FIFO allocation against remaining receipt balances. */
export function allocateFxIntakeReceipts(
  receipts: FxIntakeReceipt[],
  ilsAmount: number,
  purchaseRate: number,
): FxAllocationPreview {
  const usdReceived = purchaseRate > 0 && ilsAmount > 0 ? round2(ilsAmount / purchaseRate) : 0;
  let remaining = round2(ilsAmount);
  const lines: FxPurchaseIntakeAllocation[] = [];
  let totalProfitIls = 0;
  let totalLossIls = 0;

  for (const receipt of receipts) {
    if (remaining <= 0.005) break;
    const take = round2(Math.min(remaining, receipt.remainingIls));
    if (take <= 0.005) continue;
    const profitIls = computeIntakeLineFxPl(take, receipt.intakeRate, purchaseRate);
    if (profitIls > 0.005) totalProfitIls += profitIls;
    else if (profitIls < -0.005) totalLossIls += Math.abs(profitIls);

    lines.push({
      paymentId: receipt.paymentId,
      orderId: receipt.orderId,
      orderNumber: receipt.orderNumber,
      dateYmd: receipt.dateYmd,
      dateLabel: receipt.dateLabel,
      sourceLabel: receipt.sourceLabel,
      ilsAmount: take,
      intakeRate: receipt.intakeRate,
      purchaseRate,
      profitIls,
    });
    remaining = round2(remaining - take);
  }

  const shortfallIls = remaining > 0.005 ? remaining : 0;
  return {
    lines,
    totalProfitIls: round2(totalProfitIls),
    totalLossIls: round2(totalLossIls),
    netProfitIls: round2(totalProfitIls - totalLossIls),
    shortfallIls,
    usdReceived,
    receipts,
  };
}

const paymentSelect = {
  id: true,
  paymentCode: true,
  orderId: true,
  intakeDate: true,
  paymentDate: true,
  createdAt: true,
  amountIls: true,
  amountUsd: true,
  paymentMethod: true,
  usdPaymentMethod: true,
  ilsPaymentMethod: true,
  exchangeRate: true,
  methodAllocations: { select: { method: true, currency: true, sourceAmount: true } },
  customer: { select: { displayName: true } },
  order: { select: { orderNumber: true } },
} as const;

export async function loadWeekIntakeReceipts(
  weekCode: string,
  track: FxPurchaseTrack,
  snapshot: CashControlSnapshot,
  tx: PrismaTx = prisma,
): Promise<FxIntakeReceipt[]> {
  const payments = await tx.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(weekCode.trim()),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: paymentSelect,
  });
  return buildIntakeReceipts(payments, snapshot, track);
}

export async function previewFxAllocation(input: {
  weekCode: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  purchaseRate: number;
  snapshot?: CashControlSnapshot;
  tx?: PrismaTx;
}): Promise<FxAllocationPreview> {
  const tx = input.tx ?? prisma;
  const snapshot =
    input.snapshot ?? (await loadCashControlSnapshot(input.weekCode, tx));
  const receipts = await loadWeekIntakeReceipts(input.weekCode, input.track, snapshot, tx);
  return allocateFxIntakeReceipts(receipts, input.ilsAmount, input.purchaseRate);
}
