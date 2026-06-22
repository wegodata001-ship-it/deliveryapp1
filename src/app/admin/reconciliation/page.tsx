import { requireRoutePermission } from "@/lib/route-access";
import { ReconciliationClient } from "@/components/admin/ReconciliationClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  await requireRoutePermission(["view_reports"]);
  return <ReconciliationClient />;
}
