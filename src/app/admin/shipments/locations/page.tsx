import { requireRoutePermission } from "@/lib/route-access";
import { listZones } from "@/app/admin/shipments/service";
import {
  cleanupMisimportedAreasAndLocations,
  listAliasMappingRows,
  listDeliveryLocations,
  renormalizeDeliveryLocationAliases,
} from "@/app/admin/shipments/location-service";
import { LocationsAdminClient } from "@/components/admin/shipments/LocationsAdminClient";
import "@/app/admin/shipments/shipments.css";

export const dynamic = "force-dynamic";

export default async function ShipmentLocationsPage() {
  await requireRoutePermission(["manage_shipments", "view_shipments"]);

  // ניקוי בטוח אוטומטי: אזורים=יישובים / יישובים=אזורים מהייבוא השגוי
  await cleanupMisimportedAreasAndLocations();
  try {
    await renormalizeDeliveryLocationAliases();
  } catch (e) {
    console.error("[locations] renormalize on load failed", e);
  }

  const [initialMappings, initialZones, initialLocations] = await Promise.all([
    listAliasMappingRows({ includeInactive: true }),
    listZones(),
    listDeliveryLocations({ includeInactive: true }),
  ]);

  return (
    <LocationsAdminClient
      initialMappings={initialMappings}
      initialZones={initialZones}
      initialLocations={initialLocations}
    />
  );
}
