/**
 * חריגות בקרת תזרים — שבועי, מבוסס על קליטות Payment מול ספירת מנהל.
 */

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyDrawerValues, CashDailyIntakeTotals } from "@/lib/cash-control-daily";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import { allCashControlChannels } from "@/lib/cash-control-channel";
import {
  aggregateExpensesByMethod,
} from "@/lib/cash-expense-payment-method";
import {
  computeCashVarianceDay,
  type CashVarianceDaySummary,
  type CashVarianceLineDto,
} from "@/lib/cash-control-variance";

function parseMoney(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function drillToIntake(drill: FlowWeekDrillPayload): CashDailyIntakeTotals {
  const pi = drill.paymentIntake;
  const out = emptyDailyIntake();
  for (const id of allCashControlChannels()) {
    out[id] = parseMoney(pi[id]);
  }
  return out;
}

/** ספירת מנהל שבועית (5 שורות) → ערוצי בקרת קופה */
function drillToDrawer(drill: FlowWeekDrillPayload): CashDailyDrawerValues {
  const c = drill.flow.counted;
  const line = (id: "CASH_ILS" | "CASH_USD" | "CREDIT" | "CHECK" | "BANK_TRANSFER") => {
    const raw = c[id];
    if (raw == null || raw === "") return null;
    return parseMoney(raw);
  };
  return {
    CASH_ILS: line("CASH_ILS"),
    CASH_USD: line("CASH_USD"),
    CREDIT_CARD_ILS: line("CREDIT"),
    CHECK_ILS: line("CHECK"),
    BANK_TRANSFER_ILS: line("BANK_TRANSFER"),
  };
}

function drillToExpenses(drill: FlowWeekDrillPayload): CashDailyIntakeTotals {
  return aggregateExpensesByMethod(
    drill.expenses.map((e) => ({
      currency: e.currency,
      amount: e.amount,
      paymentMethod: e.paymentMethod,
    })),
  );
}

export function computeFlowWeekVariance(drill: FlowWeekDrillPayload): CashVarianceDaySummary {
  const expenses = drillToExpenses(drill);
  return computeCashVarianceDay(drillToIntake(drill), drillToDrawer(drill), expenses);
}

export function getFlowWeekVarianceLines(drill: FlowWeekDrillPayload): CashVarianceLineDto[] {
  return computeFlowWeekVariance(drill).lines;
}

/** הפרש לתצוגה בטבלה 3: נספר − צפוי נטו */
export function flowDisplayDiff(line: CashVarianceLineDto): number | null {
  return line.variance;
}
