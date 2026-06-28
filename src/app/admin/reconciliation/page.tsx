import { requireRoutePermission } from "@/lib/route-access";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ReconciliationClient } from "@/components/admin/ReconciliationClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  await requireRoutePermission(["view_reports"]);
  const me = await requireAuth();
  const canEdit = userHasAnyPermission(me, ["edit_orders"]);
  return <ReconciliationClient canEdit={canEdit} />;
}
