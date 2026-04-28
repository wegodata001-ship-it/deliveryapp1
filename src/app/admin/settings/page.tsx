import { getAdminSettingsAction } from "@/app/admin/settings/actions";
import { AdminSettingsClient } from "@/components/admin/AdminSettingsClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SettingsPage() {
  await requireRoutePermission(["manage_settings"]);
  const initial = await getAdminSettingsAction();
  return <AdminSettingsClient initial={initial} />;
}
