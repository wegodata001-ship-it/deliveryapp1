"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getFlowWeekAction(week: string): Promise<FlowWeekPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadFlowWeek(week);
}
