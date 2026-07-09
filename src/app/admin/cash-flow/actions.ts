"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";

/**
 * Server Actions למודול «בקרת תזרים».
 * מייצא אך ורק פונקציות async — הטיפוסים ב-types.ts.
 */

const VIEW_PERMS = ["cashflow.view", "view_payment_control"];

export async function getCashFlowCapabilitiesAction(): Promise<CashFlowCapabilities> {
  const me = await requireAuth();
  const admin = isAdminUser(me);
  const legacyManager = admin || userHasAnyPermission(me, ["view_payment_control"]);
  const has = (k: string) => admin || me.permissionKeys.includes(k);

  return {
    canView: admin || userHasAnyPermission(me, VIEW_PERMS) || userHasAnyPermission(me, ["manage_cash_expenses"]),
    canCountCreate: legacyManager || has("cashflow.count.create"),
    canCountEdit: legacyManager || has("cashflow.count.edit"),
    canCountApprove: legacyManager || has("cashflow.count.approve"),
    canExpenseCreate: legacyManager || has("manage_cash_expenses"),
    canExpenseEdit: legacyManager || has("manage_cash_expenses"),
    canExpenseDelete: admin || has("manage_cash_expenses"),
    canExport: legacyManager || has("cashflow.export"),
    canManageFlow: legacyManager,
  };
}
