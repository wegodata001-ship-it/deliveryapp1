"use server";

import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";

/**
 * מודול «בקרת תזרים» (Cash Flow Control) — שכבת הרשאות.
 *
 * חשוב ארכיטקטונית: המודול הזה אינו מגדיר מקור נתונים חדש.
 * הוא צורך את אותם ה-Actions / Services / Models הקיימים:
 *   - סיכום שבוע / יום / פירוט אמצעי: @/app/admin/cash-control/daily-actions
 *   - הוצאות קופה:                    @/app/admin/cash-expenses/actions
 *   - רכישת מט"ח / העברות / יתרות:     @/app/admin/cash-control/week-flow-actions
 * מסך «בקרת קופה» ומסך «בקרת תזרים» שניהם צרכנים של אותו מקור נתונים יחיד.
 */

// גישה למודול: הרשאת תזרים ייעודית או בקרת קופה קיימת (תאימות לאחור)
const VIEW_PERMS = ["cashflow.view", "view_payment_control"];

export type CashFlowCapabilities = {
  canView: boolean;
  canCountCreate: boolean;
  canCountEdit: boolean;
  canCountApprove: boolean;
  canExpenseCreate: boolean;
  canExpenseEdit: boolean;
  canExpenseDelete: boolean;
  canExport: boolean;
  /** נדרש למילוי שדות רכישת מט"ח / העברות / יתרות (כרגע מנהל בלבד) */
  canManageFlow: boolean;
};

export async function getCashFlowCapabilitiesAction(): Promise<CashFlowCapabilities> {
  const me = await requireAuth();
  const admin = isAdminUser(me);
  // תאימות לאחור: מי שיש לו גישה לבקרת קופה נחשב "מנהל תזרים" מלא
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
