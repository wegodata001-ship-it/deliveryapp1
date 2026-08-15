"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/admin-auth";
import { canManageAllCashExpenses } from "@/app/admin/cash-expenses/rbac";
import { deleteCashExpense } from "@/app/admin/cash-expenses/service";

const REVALIDATE_PATHS = ["/admin/cash-control", "/admin/cash-expenses", "/admin/cash-flow"] as const;

export async function deleteCashExpenseAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAuth();
  if (!canManageAllCashExpenses(me)) {
    return { ok: false, error: "אין הרשאה למחוק" };
  }
  const res = await deleteCashExpense({
    id,
    deletedById: me.id,
    deletedByName: me.fullName ?? me.email ?? null,
  });
  if (res.ok) {
    for (const p of REVALIDATE_PATHS) revalidatePath(p);
  }
  return res;
}
