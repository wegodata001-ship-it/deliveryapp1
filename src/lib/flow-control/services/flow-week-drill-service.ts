/**
 * FlowWeekDrillService — פירוט שבוע לבקרת תזרים (הרחבת שורה).
 */

import { Prisma } from "@prisma/client";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekDrillExpenseRow, FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";
import { aggregateDailyIntakes, emptyDailyIntake } from "@/lib/cash-control-daily";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { loadFlowWeekApprovedSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import { formatAhWeekLabel, formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { prisma } from "@/lib/prisma";

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function reasonLabel(reason: string): string {
  return CASH_EXPENSE_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export async function loadFlowWeekDrill(week: string): Promise<FlowWeekDrillPayload | null> {
  const wk = week.trim();
  const [flow, dailySummary, expenses, payments] = await Promise.all([
    loadFlowWeek(wk),
    loadFlowWeekApprovedSummary(wk),
    prisma.cashExpense.findMany({
      where: { weekCode: wk, status: "ACTIVE" },
      orderBy: { expenseDate: "asc" },
      include: { createdBy: { select: { fullName: true } } },
    }),
    prisma.payment.findMany({
      where: cashControlWeekReconciliationPaymentsWhere(wk),
      select: {
        amountIls: true,
        amountUsd: true,
        paymentMethod: true,
        usdPaymentMethod: true,
        ilsPaymentMethod: true,
        notes: true,
        exchangeRate: true,
        paymentDate: true,
        createdAt: true,
      },
    }),
  ]);

  if (!flow) return null;

  const intakeByDay = aggregateDailyIntakes(payments);
  const paymentIntake = emptyDailyIntake();
  for (const totals of intakeByDay.values()) {
    for (const k of Object.keys(paymentIntake) as (keyof typeof paymentIntake)[]) {
      paymentIntake[k] = Math.round((paymentIntake[k] + totals[k]) * 100) / 100;
    }
  }

  const expenseRows: FlowWeekDrillExpenseRow[] = expenses.map((e) => {
    const when = new Date(e.expenseDate);
    return {
      id: e.id,
      dateYmd: formatYmdJerusalem(when),
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      reasonLabel: reasonLabel(e.reason),
      currency: e.currency as "ILS" | "USD",
      amount: money(e.amount),
      createdByName: e.createdBy?.fullName ?? null,
    };
  });

  const dailyCounts = dailySummary?.rows.filter((r) => !r.isTotal && r.dateYmd) ?? [];

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    flow,
    dailyCounts,
    expenses: expenseRows,
    paymentIntake: Object.fromEntries(
      Object.entries(paymentIntake).map(([k, v]) => [k, money(v)]),
    ) as FlowWeekDrillPayload["paymentIntake"],
  };
}
