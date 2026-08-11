import { resolveDeliveryLocation } from "@/lib/delivery-location-match";
import type { ShipmentImportLocationMapping } from "@/lib/shipment-import-preview-utils";

export type { ShipmentImportLocationMapping } from "@/lib/shipment-import-preview-utils";
export {
  applyImportLocationMappingsToRows,
  enrichExcelPreviewRows,
} from "@/lib/shipment-import-preview-utils";

function placeKey(value: string): string {
  return value.trim();
}

/** בודק טבלת התאמות — מחזיר רק מקומות עם שם מעודכן שונה מהמקור */
export async function previewImportLocationMappings(
  originalPlaces: string[],
): Promise<ShipmentImportLocationMapping[]> {
  const unique = [...new Set(originalPlaces.map(placeKey).filter(Boolean))];
  const mappings: ShipmentImportLocationMapping[] = [];

  for (const originalPlace of unique) {
    const match = await resolveDeliveryLocation({ city: originalPlace, address: null });
    if (match.status !== "MATCHED" || !match.city) continue;
    if (placeKey(match.city) === placeKey(originalPlace)) continue;

    mappings.push({
      originalPlace,
      updatedPlace: match.city,
      deliveryLocationId: match.deliveryLocationId,
      zoneId: match.zoneId,
      zoneName: match.zoneName,
    });
  }

  mappings.sort((a, b) => a.originalPlace.localeCompare(b.originalPlace, "he"));
  return mappings;
}
