import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  canCreateCashExpense as userCanCreateCashExpense,
  canManageAllCashExpenses as userCanManageAllCashExpenses,
} from "@/app/admin/cash-expenses/rbac";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";

export async function DashboardQuickActionsServer() {
  const me = await requireAuth();
  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
  const canViewReports = userHasAnyPermission(me, ["view_reports"]);
  const canCreateCashExpense = userCanCreateCashExpense(me);
  const canManageAllCashExpenses = userCanManageAllCashExpenses(me);

  if (!canCreateOrders && !canReceivePayments && !canViewReports && !canCreateCashExpense) {
    return null;
  }

  return (
    <DashboardQuickActions
      canCreateOrders={canCreateOrders}
      canReceivePayments={canReceivePayments}
      canViewReports={canViewReports}
      canCreateCashExpense={canCreateCashExpense}
      canManageAllCashExpenses={canManageAllCashExpenses}
      currentUserId={me.id}
    />
  );
}
