"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadCashControlWeekPageData, loadCashControlWeekSummary } from "@/app/admin/cash-control/daily-service";
import { loadWeekBalanceState } from "@/lib/cash-control/week-balance-service";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";
import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getCashControlWeekSummaryAction(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadCashControlWeekSummary(week);
}

export async function getCashControlWeekPageDataAction(week: string): Promise<{
  summary: CashDailyWeekSummaryPayload | null;
  weekBalance: WeekBalanceStateDto | null;
}> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { summary: null, weekBalance: null };
  const page = await loadCashControlWeekPageData(week);
  const weekBalance = page.aggregates
    ? await loadWeekBalanceState(week, page.aggregates)
    : null;
  return { summary: page.summary, weekBalance };
}
