import { requireRoutePermission } from "@/lib/route-access";
import { listCouriers, listZones } from "@/app/admin/shipments/service";
import { ShipmentImportClient } from "@/components/admin/shipments/ShipmentImportClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentImportPage() {
  await requireRoutePermission(["manage_shipments"]);
  const [zones, couriers] = await Promise.all([listZones(), listCouriers()]);
  return <ShipmentImportClient initialZones={zones} initialCouriers={couriers} />;
}
