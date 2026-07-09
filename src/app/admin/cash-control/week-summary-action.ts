"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadCashControlWeekSummary } from "@/app/admin/cash-control/daily-service";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getCashControlWeekSummaryAction(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadCashControlWeekSummary(week);
}
