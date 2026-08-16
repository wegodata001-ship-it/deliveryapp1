import { requireRoutePermission } from "@/lib/route-access";
import { requireShipmentCountryFromSlug } from "@/lib/shipment-country-scope";
import { listZones } from "@/app/admin/shipments/service";
import {
  listAliasMappingRows,
  listDeliveryLocations,
} from "@/app/admin/shipments/location-service";
import { LocationsAdminClient } from "@/components/admin/shipments/LocationsAdminClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentLocationsPage({
  params,
}: {
  params: Promise<{ countrySlug: string }>;
}) {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);
  const { countrySlug } = await params;
  const { workCountry } = requireShipmentCountryFromSlug(countrySlug);

  const [initialMappings, initialZones, initialLocations] = await Promise.all([
    listAliasMappingRows(workCountry, { includeInactive: true }),
    listZones(workCountry),
    listDeliveryLocations(workCountry, { includeInactive: true }),
  ]);

  return (
    <LocationsAdminClient
      initialMappings={initialMappings}
      initialZones={initialZones}
      initialLocations={initialLocations}
    />
  );
}
