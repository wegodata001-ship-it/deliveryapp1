import { getActivityDashboardAction } from "@/app/admin/activity/actions";
import { ActivityDashboardClient } from "@/components/admin/ActivityDashboardClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ActivityPage() {
  await requireRoutePermission(["manage_users"]);
  const initialPayload = await getActivityDashboardAction();
  return <ActivityDashboardClient initialPayload={initialPayload} />;
}
