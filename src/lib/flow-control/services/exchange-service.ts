/**
 * ExchangeService — רכישות מט"ח (append-only).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeAvailableIlsForFx,
  computeFxRemainderAfterPurchase,
  computeFxUsdReceived,
  parseFxPurchasesJson,
  sumFxPurchases,
  validateFxRemainderSplit,
} from "@/lib/flow-control/flow-calculation-service";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
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
  if (input.ilsAmount <= 0) return { ok: false, error: "סכום רכישה חייב להיות חיובי" };
  if (input.rate <= 0) return { ok: false, error: "שער דולר חייב להיות חיובי" };

  const usdReceived = computeFxUsdReceived(input.ilsAmount, input.rate);
  const row = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
  });
  const cashCount = await loadFlowWeekCashCount(wk);
  const existing = parseFxPurchasesJson(row?.fxPurchases);
  const managerCashIls = cashCount.countedCashIls ?? 0;
  const availableIls = computeAvailableIlsForFx(managerCashIls, cashCount.expensesIls, existing);
  const remainderAfter = computeFxRemainderAfterPurchase(availableIls, input.ilsAmount);

  if (!validateFxRemainderSplit(input.remainderCashIls, input.remainderBankIls, remainderAfter)) {
    return {
      ok: false,
      error: `סכום היתרה (${(input.remainderCashIls + input.remainderBankIls).toLocaleString("he-IL")}) חייב להשוות ל-${remainderAfter.toLocaleString("he-IL")} ₪`,
    };
  }

  const record: FxPurchaseRecord = {
    id: `fx-${Date.now()}`,
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
  const totals = sumFxPurchases(all);

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

  return { ok: true };
}
