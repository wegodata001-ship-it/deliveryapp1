"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeek } from "@/app/admin/cash-flow/week-flow-service";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import type { WorkCountryCode } from "@/lib/work-country";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function getFlowWeekAction(
  week: string,
  workCountry?: WorkCountryCode | string,
): Promise<FlowWeekPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const scope = requireWorkCountryScope(workCountry);
  return loadFlowWeek(week, scope.workCountry);
}
