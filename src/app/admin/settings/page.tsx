import { SettingsMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SettingsPage() {
  await requireRoutePermission(["manage_settings"]);
  return <SettingsMock />;
}
