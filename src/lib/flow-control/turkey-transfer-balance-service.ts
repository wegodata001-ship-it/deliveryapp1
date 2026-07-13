/**
 * יתרה להעברה לטורקיה — חישוב מתנועות (לא מהזמנות / לא מחוב לקוח).
 */

import { Prisma, TurkeyTransferCurrency as DbCurrency, TurkeyTransferMovementType as DbType } from "@prisma/client";
import { parseAhWeekNumber } from "@/lib/weeks/ah-week-nav";
import {
  type TurkeyTransferBalanceResult,
  type TurkeyTransferBalanceWeekSummary,
  type TurkeyTransferCurrency,
  type TurkeyTransferMovementDto,
  type TurkeyTransferMovementType,
  type TurkeyWeekStatus,
} from "@/lib/flow-control/turkey-transfer-balance-types";

const EPS = 0.02;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function signedMovementAmount(type: TurkeyTransferMovementType, amount: number): number {
  const abs = Math.abs(amount);
  switch (type) {
    case "TRANSFER_TO_TURKEY":
      return -abs;
    case "MANUAL_ADJUSTMENT":
      return round2(amount);
    default:
      return abs;
  }
}

type MovementRow = {
  id: string;
  weekCode: string;
  type: DbType;
  currency: DbCurrency;
  amount: Prisma.Decimal;
  balanceBefore: Prisma.Decimal | null;
  balanceAfter: Prisma.Decimal | null;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: { fullName: string } | null;
};

function toDto(row: MovementRow): TurkeyTransferMovementDto {
  const amount = num(row.amount);
  return {
    id: row.id,
    weekCode: row.weekCode,
    type: row.type as TurkeyTransferMovementType,
    currency: row.currency as TurkeyTransferCurrency,
    amount,
    signedAmount: signedMovementAmount(row.type as TurkeyTransferMovementType, amount),
    balanceBefore: row.balanceBefore != null ? num(row.balanceBefore) : null,
    balanceAfter: row.balanceAfter != null ? num(row.balanceAfter) : null,
    reference: row.reference,
    notes: row.notes,
    createdByName: row.createdBy?.fullName ?? null,
    createdAtIso: row.createdAt.toISOString(),
    createdAtDisplay: row.createdAt.toLocaleDateString("he-IL"),
  };
}

export function sumMovementsByCurrency(
  movements: Array<{ type: TurkeyTransferMovementType; currency: TurkeyTransferCurrency; amount: number }>,
  currency: TurkeyTransferCurrency,
): number {
  let sum = 0;
  for (const m of movements) {
    if (m.currency !== currency) continue;
    sum += signedMovementAmount(m.type, m.amount);
  }
  return round2(sum);
}

export function computeWeekTurkeySummary(params: {
  currency: TurkeyTransferCurrency;
  openingBalance: number;
  weekMovements: Array<{ type: TurkeyTransferMovementType; currency: TurkeyTransferCurrency; amount: number }>;
  hasCashCount: boolean;
}): TurkeyTransferBalanceWeekSummary {
  const { currency, openingBalance, weekMovements, hasCashCount } = params;
  let addedFromCashCount = 0;
  let adjusted = 0;
  let transferred = 0;
  let reversed = 0;

  for (const m of weekMovements) {
    if (m.currency !== currency) continue;
    const signed = signedMovementAmount(m.type, m.amount);
    switch (m.type) {
      case "CASH_COUNT_ALLOCATION":
        addedFromCashCount = round2(addedFromCashCount + m.amount);
        break;
      case "CASH_COUNT_ADJUSTMENT":
        adjusted = round2(adjusted + signed);
        break;
      case "TRANSFER_TO_TURKEY":
        transferred = round2(transferred + m.amount);
        break;
      case "TRANSFER_REVERSAL":
        reversed = round2(reversed + m.amount);
        break;
      case "MANUAL_ADJUSTMENT":
        adjusted = round2(adjusted + signed);
        break;
      default:
        break;
    }
  }

  const closingBalance = round2(
    openingBalance + addedFromCashCount + adjusted - transferred + reversed,
  );

  let status: TurkeyWeekStatus = "NO_COUNT";
  if (hasCashCount || addedFromCashCount > EPS) {
    status = "COUNT_SAVED";
  }
  if (Math.abs(adjusted) > EPS) {
    status = "HAS_ADJUSTMENT";
  }
  if (closingBalance > EPS) {
    status = transferred > EPS ? "PARTIALLY_TRANSFERRED" : "AWAITING_TRANSFER";
  } else if (closingBalance <= EPS && transferred > EPS) {
    status = "FULLY_TRANSFERRED";
  }

  return {
    currency,
    openingBalance: round2(openingBalance),
    addedFromCashCount,
    adjusted,
    transferred,
    reversed,
    closingBalance,
    status,
  };
}

export function buildTurkeyBalanceResult(params: {
  weekCode: string;
  openingUsd: number;
  openingIls: number;
  movements: TurkeyTransferMovementDto[];
  hasCashCount: boolean;
}): TurkeyTransferBalanceResult {
  const weekMovs = params.movements.filter((m) => m.weekCode === params.weekCode);
  const usd = computeWeekTurkeySummary({
    currency: "USD",
    openingBalance: params.openingUsd,
    weekMovements: weekMovs,
    hasCashCount: params.hasCashCount,
  });
  const ils = computeWeekTurkeySummary({
    currency: "ILS",
    openingBalance: params.openingIls,
    weekMovements: weekMovs,
    hasCashCount: params.hasCashCount,
  });

  return {
    usd,
    ils,
    actualTransfersUsd: usd.transferred,
    actualTransfersIls: ils.transferred,
    movements: params.movements,
  };
}

export async function loadTurkeyMovementsUpToWeek(
  weekCode: string,
  countryCode: "TR" = "TR",
): Promise<TurkeyTransferMovementDto[]> {
  const { prisma } = await import("@/lib/prisma");
  if (typeof prisma.turkeyTransferMovement?.findMany !== "function") {
    console.warn(
      "[turkey-balance] Prisma client missing turkeyTransferMovement — restart dev server after prisma generate",
    );
    return [];
  }
  const targetWeek = parseAhWeekNumber(weekCode);
  if (targetWeek == null) return [];

  const rows = await prisma.turkeyTransferMovement.findMany({
    where: { countryCode },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      weekCode: true,
      type: true,
      currency: true,
      amount: true,
      balanceBefore: true,
      balanceAfter: true,
      reference: true,
      notes: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
    },
  });

  return rows
    .filter((r) => {
      const wn = parseAhWeekNumber(r.weekCode);
      return wn != null && wn <= targetWeek;
    })
    .map(toDto);
}

export function computeOpeningBalanceBeforeWeek(
  movements: TurkeyTransferMovementDto[],
  weekCode: string,
  currency: TurkeyTransferCurrency,
): number {
  const targetWeek = parseAhWeekNumber(weekCode);
  if (targetWeek == null) return 0;

  const prior = movements.filter((m) => {
    if (m.currency !== currency) return false;
    const wn = parseAhWeekNumber(m.weekCode);
    return wn != null && wn < targetWeek;
  });

  return sumMovementsByCurrency(prior, currency);
}

export async function loadTurkeyBalanceForWeek(weekCode: string): Promise<TurkeyTransferBalanceResult> {
  const movements = await loadTurkeyMovementsUpToWeek(weekCode);
  const { prisma } = await import("@/lib/prisma");
  const flow = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: weekCode.trim() } },
    select: { countedCashUsd: true, countedCashIls: true },
  });
  const hasCashCount =
    flow?.countedCashUsd != null ||
    flow?.countedCashIls != null ||
    movements.some((m) => m.weekCode === weekCode && m.type === "CASH_COUNT_ALLOCATION");

  return buildTurkeyBalanceResult({
    weekCode: weekCode.trim(),
    openingUsd: computeOpeningBalanceBeforeWeek(movements, weekCode, "USD"),
    openingIls: computeOpeningBalanceBeforeWeek(movements, weekCode, "ILS"),
    movements,
    hasCashCount,
  });
}

export async function getCurrentTurkeyBalanceUsd(weekCode: string): Promise<number> {
  const balance = await loadTurkeyBalanceForWeek(weekCode);
  return balance.usd.closingBalance;
}

/** סנכרון הקצאה מספירת קופה — idempotent, עם התאמה אם כבר הועבר */
export async function syncCashCountTurkeyAllocationInTx(
  tx: Prisma.TransactionClient,
  params: {
    weekCode: string;
    cashWeekFlowId: string;
    allocationUsd: number;
    allocationIls?: number;
    userId: string;
    note?: string | null;
  },
): Promise<void> {
  const wk = params.weekCode.trim();
  const usdAmount = round2(Math.max(0, params.allocationUsd));

  await syncCurrencyAllocationInTx(tx, {
    ...params,
    weekCode: wk,
    currency: "USD",
    newAmount: usdAmount,
  });

  const ilsAmount = round2(Math.max(0, params.allocationIls ?? 0));
  if (ilsAmount > EPS) {
    await syncCurrencyAllocationInTx(tx, {
      ...params,
      weekCode: wk,
      currency: "ILS",
      newAmount: ilsAmount,
    });
  }
}

async function syncCurrencyAllocationInTx(
  tx: Prisma.TransactionClient,
  params: {
    weekCode: string;
    cashWeekFlowId: string;
    currency: TurkeyTransferCurrency;
    newAmount: number;
    userId: string;
    note?: string | null;
  },
): Promise<void> {
  const existingAlloc = await tx.turkeyTransferMovement.findFirst({
    where: {
      cashWeekFlowId: params.cashWeekFlowId,
      type: DbType.CASH_COUNT_ALLOCATION,
      currency: params.currency as DbCurrency,
    },
    orderBy: { createdAt: "desc" },
  });

  const hasTransfers = await tx.turkeyTransferMovement.count({
    where: {
      weekCode: params.weekCode,
      currency: params.currency as DbCurrency,
      type: DbType.TRANSFER_TO_TURKEY,
    },
  });

  const currentBalance = await computeBalanceInTx(tx, params.weekCode, params.currency);

  if (!existingAlloc && params.newAmount <= EPS) return;

  if (hasTransfers === 0) {
    if (!existingAlloc) {
      if (params.newAmount <= EPS) return;
      const after = round2(currentBalance + params.newAmount);
      await tx.turkeyTransferMovement.create({
        data: {
          countryCode: "TR",
          weekCode: params.weekCode,
          cashWeekFlowId: params.cashWeekFlowId,
          type: DbType.CASH_COUNT_ALLOCATION,
          currency: params.currency as DbCurrency,
          amount: new Prisma.Decimal(params.newAmount.toFixed(4)),
          balanceBefore: new Prisma.Decimal(currentBalance.toFixed(4)),
          balanceAfter: new Prisma.Decimal(after.toFixed(4)),
          notes: params.note ?? "הקצאה מספירת קופה",
          createdById: params.userId,
        },
      });
      return;
    }

    const oldAmount = num(existingAlloc.amount);
    if (Math.abs(oldAmount - params.newAmount) <= EPS) return;

    const after = round2(currentBalance - oldAmount + params.newAmount);
    await tx.turkeyTransferMovement.update({
      where: { id: existingAlloc.id },
      data: {
        amount: new Prisma.Decimal(params.newAmount.toFixed(4)),
        balanceAfter: new Prisma.Decimal(after.toFixed(4)),
        notes: params.note ?? existingAlloc.notes,
      },
    });
    return;
  }

  const oldAmount = existingAlloc ? num(existingAlloc.amount) : 0;
  const delta = round2(params.newAmount - oldAmount);
  if (Math.abs(delta) <= EPS) return;

  const after = round2(currentBalance + delta);
  await tx.turkeyTransferMovement.create({
    data: {
      countryCode: "TR",
      weekCode: params.weekCode,
      cashWeekFlowId: params.cashWeekFlowId,
      type: DbType.CASH_COUNT_ADJUSTMENT,
      currency: params.currency as DbCurrency,
      amount: new Prisma.Decimal(delta.toFixed(4)),
      balanceBefore: new Prisma.Decimal(currentBalance.toFixed(4)),
      balanceAfter: new Prisma.Decimal(after.toFixed(4)),
      notes: params.note ?? `תיקון ספירת קופה: ${delta >= 0 ? "+" : ""}$${delta.toFixed(2)}`,
      createdById: params.userId,
      metadata: {
        previousAllocationUsd: oldAmount,
        newAllocationUsd: params.newAmount,
      },
    },
  });

  if (existingAlloc && Math.abs(oldAmount - params.newAmount) > EPS) {
    await tx.turkeyTransferMovement.update({
      where: { id: existingAlloc.id },
      data: { amount: new Prisma.Decimal(params.newAmount.toFixed(4)) },
    });
  }
}

async function computeBalanceInTx(
  tx: Prisma.TransactionClient,
  weekCode: string,
  currency: TurkeyTransferCurrency,
): Promise<number> {
  const rows = await tx.turkeyTransferMovement.findMany({
    where: { countryCode: "TR", currency: currency as DbCurrency },
    select: { type: true, currency: true, amount: true, weekCode: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const targetWeek = parseAhWeekNumber(weekCode);
  const filtered = rows.filter((r) => {
    const wn = parseAhWeekNumber(r.weekCode);
    return wn != null && targetWeek != null && wn <= targetWeek;
  });
  return sumMovementsByCurrency(
    filtered.map((r) => ({
      type: r.type as TurkeyTransferMovementType,
      currency: r.currency as TurkeyTransferCurrency,
      amount: num(r.amount),
    })),
    currency,
  );
}

export async function createTurkeyTransferInTx(
  tx: Prisma.TransactionClient,
  params: {
    weekCode: string;
    currency: TurkeyTransferCurrency;
    amount: number;
    userId: string;
    reference?: string | null;
    notes?: string | null;
    transferDate?: Date;
  },
): Promise<{ id: string }> {
  const amount = round2(params.amount);
  if (amount <= EPS) throw new Error("סכום העברה חייב להיות חיובי");

  const currentBalance = await computeBalanceInTx(tx, params.weekCode, params.currency);
  if (amount > currentBalance + EPS) {
    throw new Error("לא ניתן להעביר סכום גדול מהיתרה הממתינה לטורקיה");
  }

  const after = round2(currentBalance - amount);
  const row = await tx.turkeyTransferMovement.create({
    data: {
      countryCode: "TR",
      weekCode: params.weekCode.trim(),
      type: DbType.TRANSFER_TO_TURKEY,
      currency: params.currency as DbCurrency,
      amount: new Prisma.Decimal(amount.toFixed(4)),
      balanceBefore: new Prisma.Decimal(currentBalance.toFixed(4)),
      balanceAfter: new Prisma.Decimal(after.toFixed(4)),
      reference: params.reference?.trim() || null,
      notes: params.notes?.trim() || null,
      createdById: params.userId,
      createdAt: params.transferDate ?? new Date(),
    },
  });

  await tx.auditLog.create({
    data: {
      userId: params.userId,
      actionType: "TURKEY_TRANSFER_CREATED",
      entityType: "TurkeyTransferMovement",
      entityId: row.id,
      newValue: {
        weekCode: params.weekCode,
        currency: params.currency,
        amount,
        reference: params.reference ?? null,
      },
    },
  });

  return { id: row.id };
}

export async function reverseTurkeyTransferInTx(
  tx: Prisma.TransactionClient,
  params: {
    movementId: string;
    userId: string;
    reason: string;
  },
): Promise<void> {
  const original = await tx.turkeyTransferMovement.findUnique({
    where: { id: params.movementId },
  });
  if (!original || original.type !== DbType.TRANSFER_TO_TURKEY) {
    throw new Error("העברה לא נמצאה");
  }

  const existingReversal = await tx.turkeyTransferMovement.findFirst({
    where: {
      type: DbType.TRANSFER_REVERSAL,
      metadata: { path: ["reversedMovementId"], equals: original.id },
    },
  });
  if (existingReversal) throw new Error("העברה זו כבר בוטלה");

  const currency = original.currency as TurkeyTransferCurrency;
  const amount = num(original.amount);
  const currentBalance = await computeBalanceInTx(tx, original.weekCode, currency);
  const after = round2(currentBalance + amount);

  await tx.turkeyTransferMovement.create({
    data: {
      countryCode: "TR",
      weekCode: original.weekCode,
      type: DbType.TRANSFER_REVERSAL,
      currency: original.currency,
      amount: original.amount,
      balanceBefore: new Prisma.Decimal(currentBalance.toFixed(4)),
      balanceAfter: new Prisma.Decimal(after.toFixed(4)),
      notes: params.reason.trim(),
      createdById: params.userId,
      metadata: { reversedMovementId: original.id },
    },
  });

  await tx.auditLog.create({
    data: {
      userId: params.userId,
      actionType: "TURKEY_TRANSFER_REVERSED",
      entityType: "TurkeyTransferMovement",
      entityId: original.id,
      metadata: { reason: params.reason, reversalAmount: amount },
    },
  });
}
