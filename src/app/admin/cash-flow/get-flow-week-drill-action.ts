"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeekDrill } from "@/lib/flow-control/services/flow-week-drill-service";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getFlowWeekDrillAction(week: string): Promise<FlowWeekDrillPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadFlowWeekDrill(week.trim());
}
