/**
 * TurkeyTransferService — העברות לטורקיה.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function loadFlowWeekTurkeyTransfer(weekCode: string): Promise<number> {
  const row = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: weekCode.trim() } },
    select: { turkeyTransferUsd: true },
  });
  return row?.turkeyTransferUsd != null ? numDec(row.turkeyTransferUsd) : 0;
}

export async function saveFlowWeekTurkeyTransfer(input: {
  weekCode: string;
  turkeyTransferUsd: Prisma.Decimal | null;
  updatedById: string;
}): Promise<void> {
  const wk = input.weekCode.trim();
  await prisma.cashWeekFlow.upsert({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    create: {
      countryCode: "TR",
      weekCode: wk,
      turkeyTransferUsd: input.turkeyTransferUsd,
      updatedById: input.updatedById,
    },
    update: {
      turkeyTransferUsd: input.turkeyTransferUsd,
      updatedById: input.updatedById,
    },
  });
}
