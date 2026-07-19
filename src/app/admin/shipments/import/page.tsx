import { requireRoutePermission } from "@/lib/route-access";
import { ShipmentImportClient } from "@/components/admin/shipments/ShipmentImportClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentImportPage() {
  await requireRoutePermission(["manage_shipments"]);
  return <ShipmentImportClient />;
}
