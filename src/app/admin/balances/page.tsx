import { BalancesMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function BalancesPage() {
  await requireRoutePermission(["view_reports"]);
  return <BalancesMock />;
}
