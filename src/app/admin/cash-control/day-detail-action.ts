"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { loadCashControlDayDetail } from "@/app/admin/cash-control/daily-service";
import type { CashDailyDayDetailPayload } from "@/app/admin/cash-control/daily-types";

const READ_PERMS = ["view_payment_control"];

export async function getCashControlDayDetailAction(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyDayDetailPayload | null> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, READ_PERMS)) return null;
  return loadCashControlDayDetail(input);
}
