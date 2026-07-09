"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeekReceivedSummary } from "@/app/admin/cash-flow/flow-intake-service";
import type { CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getFlowWeekReceivedSummaryAction(
  week: string,
): Promise<CashDailyWeekSummaryPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadFlowWeekReceivedSummary(week);
}
