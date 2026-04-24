import { SourceTablesMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SourceTablesPage() {
  await requireRoutePermission(["manage_settings"]);
  return <SourceTablesMock />;
}
