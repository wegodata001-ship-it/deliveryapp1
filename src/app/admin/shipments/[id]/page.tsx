import { notFound } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";
import { getShipmentBatch, listCouriers, listShipmentRecords, listZones } from "@/app/admin/shipments/service";
import { ShipmentBatchClient } from "@/components/admin/shipments/ShipmentBatchClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  const { id } = await params;
  const batch = await getShipmentBatch(id);
  if (!batch) notFound();

  const [initialRecords, zones, couriers] = await Promise.all([
    listShipmentRecords(id),
    listZones(),
    listCouriers(),
  ]);

  return (
    <ShipmentBatchClient
      batch={batch}
      initialRecords={initialRecords}
      initialZones={zones}
      initialCouriers={couriers}
    />
  );
}
