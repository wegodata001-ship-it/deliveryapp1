import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { DashboardQuickActions } from "@/components/admin/DashboardQuickActions";

export async function DashboardQuickActionsServer() {
  const me = await requireAuth();
  const canCreateOrders = userHasAnyPermission(me, ["create_orders"]);
  const canReceivePayments = userHasAnyPermission(me, ["receive_payments"]);
  const canViewReports = userHasAnyPermission(me, ["view_reports"]);

  if (!canCreateOrders && !canReceivePayments && !canViewReports) {
    return null;
  }

  return (
    <DashboardQuickActions
      canCreateOrders={canCreateOrders}
      canReceivePayments={canReceivePayments}
      canViewReports={canViewReports}
    />
  );
}
