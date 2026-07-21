import { requireRoutePermission } from "@/lib/route-access";
import { listManualShipments } from "@/app/admin/shipments/manual/service";
import { ShipmentManualEntryClient } from "@/components/admin/shipments/ShipmentManualEntryClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ManualShipmentsPage() {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const rows = await listManualShipments();

  return <ShipmentManualEntryClient initialRows={rows} />;
}
