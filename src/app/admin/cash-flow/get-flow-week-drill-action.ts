"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadFlowWeekDrill } from "@/lib/flow-control/services/flow-week-drill-service";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import type { WorkCountryCode } from "@/lib/work-country";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getFlowWeekDrillAction(
  week: string,
  workCountry?: WorkCountryCode | string,
): Promise<FlowWeekDrillPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const scope = requireWorkCountryScope(workCountry);
  return loadFlowWeekDrill(week.trim(), scope.workCountry);
}
