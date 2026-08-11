"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  confirmWeekBalance,
  loadWeekBalanceState,
} from "@/lib/cash-control/week-balance-service";
import type { WeekBalanceStateDto } from "@/lib/cash-control/week-balance-types";

const BALANCE_PERMS = ["manage_cash_expenses", "view_payment_control"];

function revalidateCashPaths(): void {
  revalidatePath("/admin/cash-control");
  revalidatePath("/admin/cash-flow");
}

export async function getWeekBalanceStateAction(
  weekCode: string,
): Promise<WeekBalanceStateDto | null> {
  await requireAuth();
  return loadWeekBalanceState(weekCode);
}

export async function confirmWeekBalanceAction(
  weekCode: string,
): Promise<{ ok: boolean; error?: string; state?: WeekBalanceStateDto }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, BALANCE_PERMS)) {
    return { ok: false, error: "אין הרשאה לאיזון שבוע" };
  }
  const res = await confirmWeekBalance({ weekCode, userId: me.id });
  if (res.ok) revalidateCashPaths();
  return res;
}
