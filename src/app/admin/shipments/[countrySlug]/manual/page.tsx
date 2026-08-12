import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { listManualShipments } from "@/app/admin/shipments/manual/service";
import { ShipmentManualEntryClient } from "@/components/admin/shipments/ShipmentManualEntryClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ManualShipmentsPage({
  params,
}: {
  params: Promise<{ countrySlug: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);
  const rows = await listManualShipments(workCountry);

  return <ShipmentManualEntryClient initialRows={rows} />;
}
