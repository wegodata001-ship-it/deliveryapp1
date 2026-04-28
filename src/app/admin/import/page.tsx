import { ExcelImportClient } from "@/components/admin/ExcelImportClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function ImportPage() {
  await requireRoutePermission(["import_excel"]);
  return <ExcelImportClient />;
}
