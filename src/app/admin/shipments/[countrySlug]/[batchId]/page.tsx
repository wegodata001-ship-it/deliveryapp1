import { notFound } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { getShipmentBatch, listCouriers, listShipmentRecords, listZones } from "@/app/admin/shipments/service";
import { listShipmentPaymentMethodsAction } from "@/app/admin/shipments/actions";
import { ShipmentBatchClient } from "@/components/admin/shipments/ShipmentBatchClient";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentBatchPage({
  params,
}: {
  params: Promise<{ countrySlug: string; batchId: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  const { countrySlug, batchId } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);
  const batch = await getShipmentBatch(batchId, workCountry);
  if (!batch) notFound();

  const [initialRecords, zones, couriers, methodsRes] = await Promise.all([
    listShipmentRecords(batchId, workCountry),
    listZones(workCountry),
    listCouriers(workCountry),
    listShipmentPaymentMethodsAction(),
  ]);

  const paymentMethods = methodsRes.ok
    ? methodsRes.methods
    : PAYMENT_METHODS.map((m) => ({ id: m.value, label: m.label }));

  return (
    <ShipmentBatchClient
      batch={batch}
      initialRecords={initialRecords}
      initialZones={zones}
      initialCouriers={couriers}
      paymentMethods={paymentMethods}
    />
  );
}
