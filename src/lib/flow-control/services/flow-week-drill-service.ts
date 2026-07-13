/**
 * FlowWeekDrillService — פירוט שבוע לבקרת תזרים (הרחבת שורה).
 */

import { Prisma } from "@prisma/client";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekDrillExpenseRow, FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";
import { paymentDayKeyJerusalem, emptyDailyIntake } from "@/lib/cash-control-daily";
import { cashControlWeekReconciliationPaymentsWhere } from "@/lib/cash-control-week-payments";
import { aggregateFlowIntakesByDay } from "@/lib/flow-control/flow-calculation-service";
import { loadFlowWeekApprovedSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import { buildFlowPaymentDailyRows } from "@/lib/flow-control/services/cashflow-received-table.service";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/cash-expense-payment-method";
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
  const [flow, dailySummary, expenses, payments, flowRow] = await Promise.all([
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
        amountWithoutVat: true,
        totalIlsWithoutVat: true,
        totalIlsWithVat: true,
        paymentDate: true,
        createdAt: true,
      },
    }),
    prisma.cashWeekFlow.findUnique({
      where: { countryCode_weekCode: { countryCode: "TR", weekCode: wk } },
      include: { updatedBy: { select: { fullName: true } } },
    }),
  ]);

  if (!flow) return null;

  const intakeByDay = aggregateFlowIntakesByDay(payments, paymentDayKeyJerusalem);
  const paymentIntake = emptyDailyIntake();
  for (const totals of intakeByDay.values()) {
    for (const k of Object.keys(paymentIntake) as (keyof typeof paymentIntake)[]) {
      paymentIntake[k] = Math.round((paymentIntake[k] + totals[k]) * 100) / 100;
    }
  }

  const expenseRows: FlowWeekDrillExpenseRow[] = expenses.map((e) => {
    const when = new Date(e.expenseDate);
    const pm = normalizePaymentMethod(e.paymentMethod);
    return {
      id: e.id,
      dateYmd: formatYmdJerusalem(when),
      timeHm: when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }),
      reasonLabel: reasonLabel(e.reason),
      currency: e.currency as "ILS" | "USD",
      paymentMethod: pm,
      paymentMethodLabel: paymentMethodLabel(pm),
      amount: money(e.amount),
      createdByName: e.createdBy?.fullName ?? null,
    };
  });

  const dailyCounts = dailySummary?.rows.filter((r) => !r.isTotal && r.dateYmd) ?? [];
  const paymentDailyRows = buildFlowPaymentDailyRows(wk, payments);

  const meta = {
    updatedByName: flowRow?.updatedBy?.fullName ?? null,
    updatedAtDisplay: flowRow?.updatedAt
      ? flowRow.updatedAt.toLocaleString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Jerusalem",
        })
      : null,
  };

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    flow,
    dailyCounts,
    paymentDailyRows,
    expenses: expenseRows,
    paymentIntake: Object.fromEntries(
      Object.entries(paymentIntake).map(([k, v]) => [k, money(v)]),
    ) as FlowWeekDrillPayload["paymentIntake"],
    meta,
  };
}
