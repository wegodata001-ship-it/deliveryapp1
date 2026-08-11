"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import type { WorkCountryCode } from "@/lib/work-country";
import { getCurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-service";
import type { CurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-types";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getCurrentFinancialBalancesAction(
  workCountry?: WorkCountryCode | string,
  asOfWeek?: string,
): Promise<CurrentFinancialBalances | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  const scope = requireWorkCountryScope(workCountry);
  return getCurrentFinancialBalances({
    workCountry: scope.workCountry,
    asOfWeek,
  });
}
