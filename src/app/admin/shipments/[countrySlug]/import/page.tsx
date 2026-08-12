import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { listCouriers, listZones } from "@/app/admin/shipments/service";
import { ShipmentImportClient } from "@/components/admin/shipments/ShipmentImportClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentImportPage({
  params,
}: {
  params: Promise<{ countrySlug: string }>;
}) {
  await requireRoutePermission(["manage_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);
  const [zones, couriers] = await Promise.all([listZones(workCountry), listCouriers(workCountry)]);
  return <ShipmentImportClient initialZones={zones} initialCouriers={couriers} />;
}
