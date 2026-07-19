/**
 * הקצאת תקבולי מזומן ₪ לרכישת מט"ח + חישוב רווח/הפסד לפי שער קליטה מול שער רכישה.
 * קריאה בלבד מ-Payment — ללא שינוי לוגיקת תשלומים.
 */

import { prisma } from "@/lib/prisma";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import {
  paymentAmountForDailyColumn,
  paymentDayKeyJerusalem,
  paymentMatchesDailyColumn,
} from "@/lib/cash-control-daily";
import { parseFxPurchasesJson } from "@/lib/flow-control/flow-calculation-service";
import type { FxPurchaseIntakeAllocation } from "@/app/admin/cash-flow/flow-types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FxIntakeReceipt = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  dateYmd: string;
  dateLabel: string;
  sourceLabel: string;
  ilsAvailable: number;
  intakeRate: number;
};

export type FxIntakeAllocationPreview = {
  lines: FxPurchaseIntakeAllocation[];
  totalProfitIls: number;
  totalLossIls: number;
  netProfitIls: number;
  shortfallIls: number;
  usdReceived: number;
};

/** רווח/הפסד לשורת תקבול: amount × (purchaseRate − intakeRate) / purchaseRate */
export function computeIntakeLineFxPl(
  ilsAmount: number,
  intakeRate: number,
  purchaseRate: number,
): number {
  if (ilsAmount <= 0 || intakeRate <= 0 || purchaseRate <= 0) return 0;
  return round2((ilsAmount * (purchaseRate - intakeRate)) / purchaseRate);
}

function consumedIlsByPayment(purchases: ReturnType<typeof parseFxPurchasesJson>): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of purchases) {
    for (const line of p.intakeAllocations ?? []) {
      map.set(line.paymentId, round2((map.get(line.paymentId) ?? 0) + line.ilsAmount));
    }
  }
  return map;
}

export async function loadWeekIlsCashIntakeReceipts(weekCode: string): Promise<FxIntakeReceipt[]> {
  const wk = weekCode.trim();
  const payments = await prisma.payment.findMany({
    where: cashControlWeekReconciliationPaymentsWhere(wk),
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      paymentCode: true,
      orderId: true,
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
    },
  });

  const flowRow = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    select: { fxPurchases: true },
  });
  const consumed = consumedIlsByPayment(parseFxPurchasesJson(flowRow?.fxPurchases));

  const receipts: FxIntakeReceipt[] = [];
  for (const p of payments) {
    if (!paymentMatchesDailyColumn(p, "CASH_ILS")) continue;
    const gross = paymentAmountForDailyColumn(p, "CASH_ILS");
    const used = consumed.get(p.id) ?? 0;
    const ilsAvailable = round2(gross - used);
    if (ilsAvailable <= 0.005) continue;

    const rate = Number(p.exchangeRate?.toString() ?? 0);
    const intakeRate = rate > 0 ? rate : 0;
    const dateYmd = paymentDayKeyJerusalem(p);
    const when = new Date(p.paymentDate ?? p.createdAt);
    const orderNumber = p.order?.orderNumber ?? null;
    const sourceLabel = orderNumber ?? p.paymentCode ?? p.customer?.displayName ?? "תקבול";

    receipts.push({
      paymentId: p.id,
      orderId: p.orderId ?? null,
      orderNumber,
      dateYmd,
      dateLabel: when.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }),
      sourceLabel,
      ilsAvailable,
      intakeRate,
    });
  }
  return receipts;
}

export function allocateFxIntakeReceipts(
  receipts: FxIntakeReceipt[],
  ilsAmount: number,
  purchaseRate: number,
): FxIntakeAllocationPreview {
  const usdReceived = purchaseRate > 0 && ilsAmount > 0 ? round2(ilsAmount / purchaseRate) : 0;
  let remaining = round2(ilsAmount);
  const lines: FxPurchaseIntakeAllocation[] = [];
  let totalProfitIls = 0;
  let totalLossIls = 0;

  for (const r of receipts) {
    if (remaining <= 0.005) break;
    const take = round2(Math.min(remaining, r.ilsAvailable));
    if (take <= 0.005) continue;
    const profitIls = computeIntakeLineFxPl(take, r.intakeRate, purchaseRate);
    if (profitIls > 0.005) totalProfitIls += profitIls;
    else if (profitIls < -0.005) totalLossIls += Math.abs(profitIls);

    lines.push({
      paymentId: r.paymentId,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      dateYmd: r.dateYmd,
      dateLabel: r.dateLabel,
      sourceLabel: r.sourceLabel,
      ilsAmount: take,
      intakeRate: r.intakeRate,
      purchaseRate,
      profitIls,
    });
    remaining = round2(remaining - take);
  }

  const shortfallIls = remaining > 0.005 ? remaining : 0;
  const netProfitIls = round2(totalProfitIls - totalLossIls);

  return {
    lines,
    totalProfitIls: round2(totalProfitIls),
    totalLossIls: round2(totalLossIls),
    netProfitIls,
    shortfallIls,
    usdReceived,
  };
}

export async function previewFxIntakeAllocation(input: {
  weekCode: string;
  ilsAmount: number;
  purchaseRate: number;
}): Promise<FxIntakeAllocationPreview> {
  const receipts = await loadWeekIlsCashIntakeReceipts(input.weekCode);
  return allocateFxIntakeReceipts(receipts, input.ilsAmount, input.purchaseRate);
}
