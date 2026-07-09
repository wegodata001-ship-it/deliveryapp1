"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

/** @deprecated — בקרת תזרים אינה מציגה פירוט קליטות תשלום */
export async function getFlowDayIntakesAction(_input: {
  week: string;
  dateYmd: string;
  column: CashDailyMethodId;
}): Promise<CashDailyMethodDetailRow[]> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return [];
  return [];
}
