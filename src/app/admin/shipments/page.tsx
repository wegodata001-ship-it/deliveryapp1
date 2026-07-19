import { requireRoutePermission } from "@/lib/route-access";
import { listCouriers, listShipmentBatches, listZones } from "@/app/admin/shipments/service";
import { ShipmentListClient } from "@/components/admin/shipments/ShipmentListClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage() {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  const [batches, zones, couriers] = await Promise.all([
    listShipmentBatches(),
    listZones(),
    listCouriers(),
  ]);

  return (
    <ShipmentListClient
      initialBatches={batches}
      initialZones={zones}
      initialCouriers={couriers}
    />
  );
}
