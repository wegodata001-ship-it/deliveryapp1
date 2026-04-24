import { ExcelImportMock } from "@/components/workflows/business-mocks";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ImportPage() {
  await requireRoutePermission(["import_excel"]);
  return <ExcelImportMock />;
}
