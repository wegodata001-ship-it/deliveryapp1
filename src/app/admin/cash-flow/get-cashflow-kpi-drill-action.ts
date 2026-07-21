"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  loadCashflowKpiDrill,
  type CashflowKpiDrillResult,
  type CashflowKpiKind,
} from "@/lib/flow-control/services/cashflow-kpi-drill-service";

const READ_PERMS = ["cashflow.view", "view_payment_control"];

export async function getCashflowKpiDrillAction(
  kind: CashflowKpiKind,
  weekCodes: string[],
): Promise<CashflowKpiDrillResult | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadCashflowKpiDrill(kind, weekCodes);
}
