"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  buildProfitLossReport,
  type ProfitLossReport,
  type ProfitLossReportFilters,
} from "@/lib/reports/build-profit-loss-report";

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) {
    throw new Error("אין הרשאה");
  }
}

export async function getProfitLossReportModalAction(
  filters: ProfitLossReportFilters,
): Promise<{ ok: true; report: ProfitLossReport } | { ok: false; error: string }> {
  try {
    await ensureAllowed();
    const report = await buildProfitLossReport(filters);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
