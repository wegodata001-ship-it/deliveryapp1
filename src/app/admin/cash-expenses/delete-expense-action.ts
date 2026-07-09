"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { deleteCashExpense } from "@/app/admin/cash-expenses/service";

const REVALIDATE_PATHS = ["/admin/cash-control", "/admin/cash-expenses", "/admin/cash-flow"] as const;

export async function deleteCashExpenseAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, ["manage_cash_expenses"])) {
    return { ok: false, error: "אין הרשאה למחוק" };
  }
  const res = await deleteCashExpense(id);
  if (res.ok) {
    for (const p of REVALIDATE_PATHS) revalidatePath(p);
  }
  return res;
}
