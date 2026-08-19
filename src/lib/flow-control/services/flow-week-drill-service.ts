/**
 * FlowWeekDrillService — פירוט שבוע לבקרת תזרים (הרחבת שורה).
 */

import { Prisma } from "@prisma/client";
import type { FlowWeekDrillExpenseRow, FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";
import { paymentDayKeyJerusalem, emptyDailyIntake } from "@/lib/cash-control-daily";
import { aggregateFlowIntakesByDay } from "@/lib/flow-control/flow-calculation-service";
import { loadFlowWeekApprovedSummary } from "@/lib/flow-control/services/cash-count-summary-service";
import { buildFlowPaymentDailyRows } from "@/lib/flow-control/services/cashflow-received-table.service";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/cash-expense-payment-method";
import { formatAhWeekLabel, formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { prisma } from "@/lib/prisma";
import { cashExpenseWhereForCountryScope, resolveCountryScopeFromCode } from "@/lib/country-data-scope";
import { flowWeekCompositeKey, type FlowWorkScope } from "@/lib/flow-control/flow-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";
import { loadFlowWeekCached } from "@/lib/flow-control/flow-week-load-cache";
import { getFlowWeekPaymentsCached } from "@/lib/flow-control/flow-week-payments-cache";
import { cashFlowPerfTimed } from "@/lib/flow-control/cash-flow-perf";

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function reasonLabel(reason: string): string {
  return CASH_EXPENSE_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export async function loadFlowWeekDrill(
  week: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<FlowWeekDrillPayload | null> {
  const wk = week.trim();
  const scope = resolveCountryScopeFromCode(workCountry);
  const flowScope: FlowWorkScope = { workCountry: scope.workCountry };

  const [flow, dailySummary, expenses, payments, flowRow] = await Promise.all([
    loadFlowWeekCached(wk, workCountry),
    loadFlowWeekApprovedSummary(wk),
    cashFlowPerfTimed("cashFlow.weeklyMovements", () =>
      prisma.cashExpense.findMany({
        where: { ...cashExpenseWhereForCountryScope(scope), weekCode: wk, status: "ACTIVE" },
        orderBy: { expenseDate: "asc" },
        select: {
          id: true,
          expenseDate: true,
          reason: true,
          currency: true,
          paymentMethod: true,
          amount: true,
          createdBy: { select: { fullName: true } },
        },
      }),
    ),
    getFlowWeekPaymentsCached(wk, scope),
    prisma.cashWeekFlow.findUnique({
      where: flowWeekCompositeKey(flowScope, wk),
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
