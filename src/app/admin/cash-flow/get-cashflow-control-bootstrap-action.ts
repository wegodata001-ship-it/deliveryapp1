"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireWorkCountryScope } from "@/lib/country-work-context.server";
import type { WorkCountryCode } from "@/lib/work-country";
import { loadFlowWeeksOverview } from "@/lib/flow-control/services/flow-weeks-overview-service";
import { loadFlowWeekDrill } from "@/lib/flow-control/services/flow-week-drill-service";
import { getCurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-service";
import type {
  FlowWeekDrillPayload,
  FlowWeekOverviewRow,
} from "@/app/admin/cash-flow/flow-types";
import type { CurrentFinancialBalances } from "@/lib/flow-control/services/current-financial-balances-types";
import {
  cashFlowPerfRun,
  cashFlowPerfStart,
  cashFlowPerfEnd,
  cashFlowPerfTimed,
} from "@/lib/flow-control/cash-flow-perf";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export type CashflowControlBootstrapPayload = {
  overviewWeeks: FlowWeekOverviewRow[];
  drill: FlowWeekDrillPayload | null;
  balances: CurrentFinancialBalances | null;
};

export async function getCashflowControlBootstrapAction(params: {
  overviewWeeks: string[];
  selectedWeek: string;
  workCountry?: WorkCountryCode | string;
  includeBalances?: boolean;
}): Promise<CashflowControlBootstrapPayload> {
  cashFlowPerfStart("cashFlow.auth");
  const me = await requireAuth();
  const authMs = cashFlowPerfEnd("cashFlow.auth");
  if (!userHasAnyPermission(me, READ_PERMS)) {
    return { overviewWeeks: [], drill: null, balances: null };
  }

  const scope = requireWorkCountryScope(params.workCountry);
  const weeks = params.overviewWeeks.map((w) => w.trim()).filter(Boolean);
  const selectedWeek = params.selectedWeek.trim();
  const includeBalances = params.includeBalances !== false;

  return cashFlowPerfRun(async () => {
    const [overviewWeeks, drill, balances] = await Promise.all([
      cashFlowPerfTimed("cashFlow.aggregation", () =>
        loadFlowWeeksOverview(weeks, scope.workCountry),
      ),
      selectedWeek
        ? cashFlowPerfTimed("cashFlow.weeklyMovements", () =>
            loadFlowWeekDrill(selectedWeek, scope.workCountry),
          )
        : Promise.resolve(null),
      includeBalances
        ? cashFlowPerfTimed("cashFlow.currentBalances", () =>
            getCurrentFinancialBalances({
              workCountry: scope.workCountry,
              asOfWeek: selectedWeek || undefined,
            }),
          )
        : Promise.resolve(null),
    ]);

    return { overviewWeeks, drill, balances };
  }, { "Auth/session": authMs ?? 0 });
}
