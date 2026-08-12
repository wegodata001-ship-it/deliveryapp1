import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import {
  listCouriers,
  listShipmentBatches,
  listShipmentRecordsByBatchIds,
  listZones,
} from "@/app/admin/shipments/service";
import { listShipmentPaymentMethodsAction } from "@/app/admin/shipments/actions";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";
import { ShipmentCombinedClient } from "@/components/admin/shipments/ShipmentCombinedClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentCombinedCountryPage({
  params,
  searchParams,
}: {
  params: Promise<{ countrySlug: string }>;
  searchParams: Promise<{ ids?: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);
  const sp = await searchParams;
  const batchIds = (sp.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const [records, zones, couriers, allBatches, methodsRes] = await Promise.all([
    listShipmentRecordsByBatchIds(batchIds, workCountry),
    listZones(workCountry),
    listCouriers(workCountry),
    listShipmentBatches(workCountry),
    listShipmentPaymentMethodsAction(),
  ]);

  const idSet = new Set(batchIds);
  const batches = allBatches.filter((b) => idSet.has(b.id));
  const paymentMethods = methodsRes.ok
    ? methodsRes.methods
    : PAYMENT_METHODS.map((m) => ({ id: m.value, label: m.label }));

  return (
    <ShipmentCombinedClient
      batchIds={batchIds}
      initialRecords={records}
      initialZones={zones}
      initialCouriers={couriers}
      initialBatches={batches}
      paymentMethods={paymentMethods}
    />
  );
}
