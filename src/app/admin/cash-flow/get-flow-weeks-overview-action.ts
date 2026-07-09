"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeeksOverview } from "@/lib/flow-control/services/flow-weeks-overview-service";
import type { FlowWeeksOverviewPayload } from "@/app/admin/cash-flow/flow-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getFlowWeeksOverviewAction(weeks: string[]): Promise<FlowWeeksOverviewPayload> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return { weeks: [] };
  const rows = await loadFlowWeeksOverview(weeks.map((w) => w.trim()).filter(Boolean));
  return { weeks: rows };
}
