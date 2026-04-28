import { CustomerBalancesClient } from "@/components/admin/CustomerBalancesClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function BalancesPage() {
  await requireRoutePermission(["view_reports"]);
  return <CustomerBalancesClient />;
}
