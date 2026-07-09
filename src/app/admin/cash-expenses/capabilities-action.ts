"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { CashExpenseCapabilities } from "@/app/admin/cash-expenses/types";

const VIEW_PERMS = ["view_payment_control", "manage_cash_expenses"];

export async function getCashExpenseCapabilitiesAction(): Promise<CashExpenseCapabilities> {
  const me = await requireAuth();
  const admin = isAdminUser(me);
  return {
    canView: admin || userHasAnyPermission(me, VIEW_PERMS),
    canCreate: admin || userHasAnyPermission(me, ["manage_cash_expenses", "view_payment_control"]),
    canEdit: admin || userHasAnyPermission(me, ["manage_cash_expenses", "view_payment_control"]),
    canDelete: admin || userHasAnyPermission(me, ["manage_cash_expenses"]),
  };
}
