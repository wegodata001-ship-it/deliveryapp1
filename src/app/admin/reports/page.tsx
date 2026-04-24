import { ReportsMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ReportsPage() {
  await requireRoutePermission(["view_reports"]);
  return <ReportsMock />;
}
