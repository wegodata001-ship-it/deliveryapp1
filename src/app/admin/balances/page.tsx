import { CustomerBalancesClient } from "@/components/admin/CustomerBalancesClient";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";

export const dynamic = "force-dynamic";

export default async function BalancesPage() {
  await requireRoutePermission(["view_reports"]);
  const me = await requireAuth();
  const canResetViaCommissions =
    isAdminUser(me) || userHasAnyPermission(me, ["receive_payments"]);
  return <CustomerBalancesClient canResetViaCommissions={canResetViaCommissions} />;
}
