/**
 * איזון שבוע — בקרת קופה.
 * משתמש באותם מצטברי SSOT כמו loadCashControlWeekSummary + computeCashVarianceDay.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import { loadCashControlWeekAggregates } from "@/app/admin/cash-control/daily-service";
import { computeCashVarianceDay } from "@/lib/cash-control-variance";
import type {
  WeekBalanceCurrencySnapshot,
  WeekBalanceSnapshot,
  WeekBalanceStateDto,
  WeekBalanceStatus,
} from "@/lib/cash-control/week-balance-types";
import { WEEK_BALANCE_STATUS_LABELS } from "@/lib/cash-control/week-balance-types";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregateCurrency(
  lines: ReturnType<typeof computeCashVarianceDay>["lines"],
  currency: "ILS" | "USD",
): WeekBalanceCurrencySnapshot {
  const curLines = lines.filter((l) => l.currency === currency);
  let income = 0;
  let expenses = 0;
  let expected = 0;
  let counted = 0;
  let diff = 0;
  for (const line of curLines) {
    income = round2(income + line.expectedAmount);
    expenses = round2(expenses + line.expensesAmount);
    expected = round2(expected + line.expectedNet);
    if (line.countedAmount != null) {
      counted = round2(counted + line.countedAmount);
      diff = round2(diff + (line.variance ?? 0));
    }
  }
  return { currency, income, expenses, expected, counted, diff };
}

export function computeWeekBalanceSnapshot(
  aggregates: Awaited<ReturnType<typeof loadCashControlWeekAggregates>>,
): WeekBalanceSnapshot | null {
  if (!aggregates) return null;
  const variance = computeCashVarianceDay(
    aggregates.weekIntake,
    aggregates.weekDrawer,
    aggregates.weekExpenses,
  );

  const hasPendingCounts = variance.lines.some(
    (l) => l.expectedAmount > CASH_CONTROL_EPS && l.countedAmount == null,
  );

  const ils = aggregateCurrency(variance.lines, "ILS");
  const usd = aggregateCurrency(variance.lines, "USD");

  const dataHash = createHash("sha256")
    .update(
      JSON.stringify({
        week: aggregates.weekCode,
        ils,
        usd,
        hasPendingCounts,
      }),
    )
    .digest("hex");

  return {
    weekCode: aggregates.weekCode,
    ils,
    usd,
    hasPendingCounts,
    dataHash,
  };
}

export function deriveWeekBalanceStatus(
  snapshot: WeekBalanceSnapshot,
  persistedStatus: string | null | undefined,
  persistedHash: string | null | undefined,
): WeekBalanceStatus {
  const withinEps = (n: number) => Math.abs(n) <= CASH_CONTROL_EPS;

  if (
    persistedStatus === "BALANCED" &&
    persistedHash &&
    persistedHash === snapshot.dataHash
  ) {
    return "BALANCED";
  }

  if (snapshot.hasPendingCounts) return "OPEN";

  const ilsOk = withinEps(snapshot.ils.diff);
  const usdOk = withinEps(snapshot.usd.diff);
  if (!ilsOk || !usdOk) return "NEEDS_BALANCE";
  return "READY";
}

export async function loadWeekBalanceState(weekCode: string): Promise<WeekBalanceStateDto | null> {
  const wk = weekCode.trim();
  const aggregates = await loadCashControlWeekAggregates(wk);
  const snapshot = computeWeekBalanceSnapshot(aggregates);
  if (!snapshot) return null;

  const flow = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
    include: { weekBalancedBy: { select: { fullName: true, email: true } } },
  });

  const status = deriveWeekBalanceStatus(
    snapshot,
    flow?.weekBalanceStatus,
    flow?.weekBalanceDataHash,
  );

  return {
    weekCode: wk,
    weekLabel: aggregates?.weekLabel ?? formatAhWeekLabel(wk),
    status,
    statusLabel: WEEK_BALANCE_STATUS_LABELS[status],
    snapshot,
    canConfirm: status === "READY",
    balancedAtIso: flow?.weekBalancedAt?.toISOString() ?? null,
    balancedByName:
      flow?.weekBalancedBy?.fullName ?? flow?.weekBalancedBy?.email ?? null,
    isBalanced: status === "BALANCED",
  };
}

export async function confirmWeekBalance(input: {
  weekCode: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string; state?: WeekBalanceStateDto }> {
  const wk = input.weekCode.trim();
  const state = await loadWeekBalanceState(wk);
  if (!state) return { ok: false, error: "שבוע לא תקין" };
  if (!state.canConfirm) {
    return { ok: false, error: "השבוע אינו מוכן לאיזון — יש לתקן הפרשים לפני אישור" };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.cashWeekFlow.upsert({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      create: {
        countryCode: "TR",
        weekCode: wk,
        weekBalanceStatus: "BALANCED",
        weekBalancedAt: now,
        weekBalancedById: input.userId,
        weekBalanceSnapshot: state.snapshot as unknown as Prisma.InputJsonValue,
        weekBalanceDataHash: state.snapshot.dataHash,
        updatedById: input.userId,
      },
      update: {
        weekBalanceStatus: "BALANCED",
        weekBalancedAt: now,
        weekBalancedById: input.userId,
        weekBalanceSnapshot: state.snapshot as unknown as Prisma.InputJsonValue,
        weekBalanceDataHash: state.snapshot.dataHash,
        updatedById: input.userId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId,
        actionType: "WEEK_BALANCED",
        entityType: "CashWeekFlow",
        entityId: wk,
        newValue: {
          status: "BALANCED",
          balancedAt: now.toISOString(),
          snapshot: state.snapshot,
        } as Prisma.InputJsonValue,
        metadata: {
          weekCode: wk,
          incomeSnapshot: {
            ils: state.snapshot.ils.income,
            usd: state.snapshot.usd.income,
          },
          expenseSnapshot: {
            ils: state.snapshot.ils.expenses,
            usd: state.snapshot.usd.expenses,
          },
          cashCountSnapshot: {
            ils: state.snapshot.ils.counted,
            usd: state.snapshot.usd.counted,
          },
          differenceSnapshot: {
            ils: state.snapshot.ils.diff,
            usd: state.snapshot.usd.diff,
          },
        } as Prisma.InputJsonValue,
      },
    });
  });

  const next = await loadWeekBalanceState(wk);
  return { ok: true, state: next ?? undefined };
}

export async function invalidateWeekBalanceIfBalanced(input: {
  weekCode: string | null | undefined;
  userId?: string | null;
  reason: string;
  trigger?: string;
}): Promise<void> {
  const wk = input.weekCode?.trim();
  if (!wk) return;

  const flow = await prisma.cashWeekFlow.findUnique({
    where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
  });
  if (!flow || flow.weekBalanceStatus !== "BALANCED") return;

  const aggregates = await loadCashControlWeekAggregates(wk);
  const snapshot = computeWeekBalanceSnapshot(aggregates);
  if (!snapshot) return;

  const nextStatus = deriveWeekBalanceStatus(snapshot, "OPEN", null);

  await prisma.$transaction(async (tx) => {
    await tx.cashWeekFlow.update({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      data: {
        weekBalanceStatus: nextStatus,
        weekBalancedAt: null,
        weekBalancedById: null,
        weekBalanceSnapshot: Prisma.DbNull,
        weekBalanceDataHash: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.userId ?? null,
        actionType: "WEEK_BALANCE_INVALIDATED",
        entityType: "CashWeekFlow",
        entityId: wk,
        oldValue: {
          status: "BALANCED",
          snapshot: flow.weekBalanceSnapshot,
          hash: flow.weekBalanceDataHash,
        } as Prisma.InputJsonValue,
        newValue: { status: nextStatus } as Prisma.InputJsonValue,
        metadata: {
          weekCode: wk,
          reason: input.reason,
          trigger: input.trigger ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  });
}
