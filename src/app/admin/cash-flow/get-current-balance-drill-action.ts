"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { WorkCountryCode } from "@/lib/work-country";
import { loadCurrentBalanceDrill } from "@/lib/flow-control/services/current-financial-balances-service";
import type {
  CurrentBalanceDrillKind,
  CurrentBalanceDrillResult,
} from "@/lib/flow-control/services/current-financial-balances-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getCurrentBalanceDrillAction(
  kind: CurrentBalanceDrillKind,
  workCountry?: WorkCountryCode | string,
  asOfWeek?: string,
): Promise<CurrentBalanceDrillResult | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const scope = requireWorkCountryScope(workCountry);
  const week = (asOfWeek?.trim() || ACTIVE_WORK_WEEK_CODE).trim();
  return loadCurrentBalanceDrill(kind, scope.workCountry, week);
}
