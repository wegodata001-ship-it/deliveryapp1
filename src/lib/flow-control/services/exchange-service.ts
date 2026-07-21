/**
 * ExchangeService — רכישות מט"ח (append-only), מופרדות לפי מסלול PS / IL.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeFxRemainderAfterPurchase,
  computeFxUsdReceived,
  computeIlAvailableIlsForFx,
  computePsAvailableIlsForFx,
  normalizeFxTrack,
  parseFxPurchasesJson,
  sumFxPurchases,
  validateFxRemainderSplit,
} from "@/lib/flow-control/flow-calculation-service";
import type { FxPurchaseRecord, FxPurchaseTrack } from "@/app/admin/cash-flow/flow-types";
import { loadFlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";

export async function loadFlowWeekFxPurchases(weekCode: string): Promise<FxPurchaseRecord[]> {
  const row = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: weekCode.trim() } },
    select: { fxPurchases: true },
  });
  return parseFxPurchasesJson(row?.fxPurchases);
}

export type AppendFxPurchaseInput = {
  weekCode: string;
  track: FxPurchaseTrack;
  ilsAmount: number;
  rate: number;
  remainderCashIls: number;
  remainderBankIls: number;
  note?: string | null;
  intakeAllocations?: FxPurchaseRecord["intakeAllocations"];
  intakeProfitIls?: number;
  intakeLossIls?: number;
  updatedById: string;
  createdByName?: string | null;
};

export async function appendFlowFxPurchase(
  input: AppendFxPurchaseInput,
): Promise<{ ok: boolean; error?: string }> {
  const wk = input.weekCode.trim();
  const track = normalizeFxTrack(input.track);
  if (input.ilsAmount <= 0) return { ok: false, error: "סכום רכישה חייב להיות חיובי" };
  if (input.rate <= 0) return { ok: false, error: "שער דולר חייב להיות חיובי" };

  const usdReceived = computeFxUsdReceived(input.ilsAmount, input.rate);
  const row = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
  });
  const cashCount = await loadFlowWeekCashCount(wk);
  const existing = parseFxPurchasesJson(row?.fxPurchases);

  const availableIls =
    track === "PS"
      ? computePsAvailableIlsForFx(cashCount.countedCashIls ?? 0, existing)
      : computeIlAvailableIlsForFx(
          cashCount.countedTransferIls ?? 0,
          cashCount.countedCreditIls ?? 0,
          cashCount.countedChecksIls ?? 0,
          existing,
        );

  if (input.ilsAmount > availableIls + 0.02) {
    const trackLabel = track === "PS" ? "PS (מזומן)" : "IL (בנקאי)";
    return {
      ok: false,
      error: `סכום הרכישה (${input.ilsAmount.toLocaleString("he-IL")} ₪) גדול מהזמין במסלול ${trackLabel} (${availableIls.toLocaleString("he-IL")} ₪)`,
    };
  }
  const remainderAfter = computeFxRemainderAfterPurchase(availableIls, input.ilsAmount);

  if (!validateFxRemainderSplit(input.remainderCashIls, input.remainderBankIls, remainderAfter)) {
    return {
      ok: false,
      error: `סכום היתרה (${(input.remainderCashIls + input.remainderBankIls).toLocaleString("he-IL")}) חייב להשוות ל-${remainderAfter.toLocaleString("he-IL")} ₪`,
    };
  }

  const record: FxPurchaseRecord = {
    id: `fx-${Date.now()}`,
    track,
    ilsAmount: input.ilsAmount,
    usdReceived,
    rate: input.rate,
    remainderCashIls: input.remainderCashIls,
    remainderBankIls: input.remainderBankIls,
    commissionUsd: cashCount.commissionUsd,
    commissionIls: cashCount.commissionIls,
    intakeAllocations: input.intakeAllocations,
    intakeProfitIls: input.intakeProfitIls,
    intakeLossIls: input.intakeLossIls,
    note: input.note?.trim() || undefined,
    createdById: input.updatedById,
    createdByName: input.createdByName ?? undefined,
    createdAt: new Date().toISOString(),
  };
  const all = [...existing, record];
  const totalsPs = sumFxPurchases(all, "PS");
  const totalsIl = sumFxPurchases(all, "IL");
  /** עמודות סיכום ישנות: PS בלבד (ללא איחוד עם IL) */
  const totals = totalsPs;

  await prisma.cashWeekFlow.upsert({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    create: {
      countryCode: "TR",
      weekCode: wk,
      fxPurchases: all as unknown as Prisma.InputJsonValue,
      fxPurchaseIls: new Prisma.Decimal(totals.ils),
      fxPurchaseUsd: new Prisma.Decimal(totals.usd),
      fxRemainderCashIls: new Prisma.Decimal(input.remainderCashIls),
      fxRemainderBankIls: new Prisma.Decimal(input.remainderBankIls),
      updatedById: input.updatedById,
    },
    update: {
      fxPurchases: all as unknown as Prisma.InputJsonValue,
      fxPurchaseIls: new Prisma.Decimal(totals.ils),
      fxPurchaseUsd: new Prisma.Decimal(totals.usd),
      fxRemainderCashIls: new Prisma.Decimal(input.remainderCashIls),
      fxRemainderBankIls: new Prisma.Decimal(input.remainderBankIls),
      updatedById: input.updatedById,
    },
  });

  void totalsIl;
  return { ok: true };
}
