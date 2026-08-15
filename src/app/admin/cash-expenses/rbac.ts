import { isAdminUser, type AppUser, userHasAnyPermission } from "@/lib/admin-auth";

/** הזנת הוצאה — עובד (manage_cash_expenses) או מנהל */
export const CASH_EXPENSE_CREATE_PERMS = ["manage_cash_expenses", "view_payment_control"] as const;

/** צפייה / ניהול / ייצוא — מנהל בלבד */
export const CASH_EXPENSE_MANAGE_PERMS = ["view_payment_control"] as const;

export function canCreateCashExpense(user: AppUser): boolean {
  return isAdminUser(user) || userHasAnyPermission(user, [...CASH_EXPENSE_CREATE_PERMS]);
}

export function canManageAllCashExpenses(user: AppUser): boolean {
  return isAdminUser(user) || userHasAnyPermission(user, [...CASH_EXPENSE_MANAGE_PERMS]);
}

export function isEmployeeExpenseEntryOnly(user: AppUser): boolean {
  return canCreateCashExpense(user) && !canManageAllCashExpenses(user);
}

/** בקרת קופה — בחירת עובד שביצע את ההוצאה */
export function canSelectExpenseOwner(user: AppUser): boolean {
  return canManageAllCashExpenses(user);
}
