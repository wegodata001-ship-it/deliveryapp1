/**
 * מקור אמת יחיד לחישוב איזון שבוע — ללא DB.
 * כל Banner / KPI / Modal / PDF חייבים להשתמש ב-computeWeeklyCashBalance.
 */

import { createHash } from "node:crypto";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import {
  emptyDailyExpenses,
  emptyDailyIntake,
  type CashDailyDrawerValues,
  type CashDailyExpenseTotals,
  type CashDailyIntakeTotals,
} from "@/lib/cash-control-daily";
import { computeCashVarianceDay } from "@/lib/cash-control-variance";
import type {
  WeekBalanceCurrencySnapshot,
  WeekBalanceSnapshot,
  WeekBalanceStatus,
} from "@/lib/cash-control/week-balance-types";

export type WeekBalanceAggregatesInput = {
  weekCode: string;
  weekIntake: CashDailyIntakeTotals;
  weekDrawer: CashDailyDrawerValues;
  weekExpenses: CashDailyExpenseTotals;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineHasActivity(
  line: ReturnType<typeof computeCashVarianceDay>["lines"][number],
): boolean {
  return (
    line.expectedAmount > CASH_CONTROL_EPS ||
    line.expensesAmount > CASH_CONTROL_EPS ||
    (line.countedAmount != null && Math.abs(line.countedAmount) > CASH_CONTROL_EPS)
  );
}

function lineNeedsCount(
  line: ReturnType<typeof computeCashVarianceDay>["lines"][number],
): boolean {
  return (
    line.countedAmount == null &&
    (line.expectedAmount > CASH_CONTROL_EPS || line.expensesAmount > CASH_CONTROL_EPS)
  );
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
      if (line.variance != null) {
        diff = round2(diff + line.variance);
      }
    }
  }
  return { currency, income, expenses, expected, counted, diff };
}

export function computeWeekBalanceSnapshot(
  aggregates: WeekBalanceAggregatesInput | null | undefined,
): WeekBalanceSnapshot | null {
  if (!aggregates) return null;
  const variance = computeCashVarianceDay(
    aggregates.weekIntake,
    aggregates.weekDrawer,
    aggregates.weekExpenses,
  );

  const hasWeekActivity = variance.lines.some(lineHasActivity);
  const hasPendingCounts = variance.lines.some(lineNeedsCount);

  const ils = aggregateCurrency(variance.lines, "ILS");
  const usd = aggregateCurrency(variance.lines, "USD");

  const dataHash = createHash("sha256")
    .update(
      JSON.stringify({
        week: aggregates.weekCode,
        ils,
        usd,
        hasWeekActivity,
        hasPendingCounts,
      }),
    )
    .digest("hex");

  return {
    weekCode: aggregates.weekCode,
    ils,
    usd,
    hasWeekActivity,
    hasPendingCounts,
    dataHash,
  };
}

/** alias לשימוש עקבי בכל המסכים */
export const computeWeeklyCashBalance = computeWeekBalanceSnapshot;

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

  if (!snapshot.hasWeekActivity) return "OPEN";

  if (snapshot.hasPendingCounts) return "NEEDS_BALANCE";

  const ilsOk = withinEps(snapshot.ils.diff);
  const usdOk = withinEps(snapshot.usd.diff);
  if (!ilsOk || !usdOk) return "NEEDS_BALANCE";
  return "READY";
}

/** עזר לבדיקות — בונה מצטבר שבוע מינימלי */
export function buildWeekBalanceAggregates(input: {
  weekCode?: string;
  intake?: Partial<CashDailyIntakeTotals>;
  drawer?: CashDailyDrawerValues;
  expenses?: Partial<CashDailyExpenseTotals>;
}): WeekBalanceAggregatesInput {
  return {
    weekCode: input.weekCode ?? "AH-135",
    weekIntake: { ...emptyDailyIntake(), ...input.intake },
    weekDrawer: input.drawer ?? {},
    weekExpenses: { ...emptyDailyExpenses(), ...input.expenses },
  };
}
