import { requireRoutePermission } from "@/lib/route-access";
import {
  listCouriers,
  listShipmentBatches,
  listShipmentRecordsByBatchIds,
  listZones,
} from "@/app/admin/shipments/service";
import { ShipmentCombinedClient } from "@/components/admin/shipments/ShipmentCombinedClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentCombinedPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const sp = await searchParams;
  const batchIds = (sp.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const [records, zones, couriers, allBatches] = await Promise.all([
    listShipmentRecordsByBatchIds(batchIds),
    listZones(),
    listCouriers(),
    listShipmentBatches(),
  ]);

  const idSet = new Set(batchIds);
  const batches = allBatches.filter((b) => idSet.has(b.id));

  return (
    <ShipmentCombinedClient
      batchIds={batchIds}
      initialRecords={records}
      initialZones={zones}
      initialCouriers={couriers}
      initialBatches={batches}
    />
  );
}
