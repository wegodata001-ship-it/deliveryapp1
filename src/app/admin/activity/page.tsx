import { ActivityLogMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ActivityPage() {
  await requireRoutePermission(["manage_users"]);
  return <ActivityLogMock />;
}
