import type { ShipmentRecordDto } from "@/app/admin/shipments/types";

/** קלט אחיד לתצוגת מקום מסירה — רשומות DB, תצוגת ייבוא, וכו'. */
export type EffectiveDeliveryPlaceInput = {
  originalDeliveryPlace?: string | null;
  originalDeliveryLocation?: string | null;
  updatedDeliveryPlace?: string | null;
  resolvedDeliveryPlace?: string | null;
  updatedDeliveryLocation?: string | null;
  city?: string | null;
  address?: string | null;
  locationMatchStatus?: ShipmentRecordDto["locationMatchStatus"];
};

/** שם מקום המסירה המקורי מהייבוא — לעולם לא מחליף את originalDeliveryLocation/Place ב-DB. */
export function shipmentOriginalDeliveryPlace(
  input: Pick<
    EffectiveDeliveryPlaceInput,
    "originalDeliveryPlace" | "originalDeliveryLocation" | "city" | "address"
  >,
): string | null {
  return (
    input.originalDeliveryPlace?.trim() ||
    input.originalDeliveryLocation?.trim() ||
    input.city?.trim() ||
    input.address?.trim() ||
    null
  );
}

/**
 * SSOT לתצוגה ולפעולות עסקיות:
 * מקום מעודכן (אם קיים) → אחרת המקורי מהייבוא.
 */
export function getEffectiveDeliveryPlace(input: EffectiveDeliveryPlaceInput): string | null {
  const updated =
    input.updatedDeliveryPlace?.trim() ||
    input.resolvedDeliveryPlace?.trim() ||
    input.updatedDeliveryLocation?.trim() ||
    null;
  if (updated) return updated;

  if (input.locationMatchStatus === "MANUALLY_FIXED" && input.city?.trim()) {
    return input.city.trim();
  }

  return shipmentOriginalDeliveryPlace(input);
}

export function getEffectiveDeliveryPlaceFromRecord(
  record: Pick<
    ShipmentRecordDto,
    | "updatedDeliveryLocation"
    | "originalDeliveryLocation"
    | "city"
    | "address"
    | "locationMatchStatus"
  >,
): string | null {
  return getEffectiveDeliveryPlace({
    originalDeliveryLocation: record.originalDeliveryLocation,
    updatedDeliveryLocation: record.updatedDeliveryLocation,
    city: record.city,
    address: record.address,
    locationMatchStatus: record.locationMatchStatus,
  });
}

export function patchShipmentRecordsAfterLocationFix<
  T extends Pick<
    ShipmentRecordDto,
    | "id"
    | "city"
    | "updatedDeliveryLocation"
    | "deliveryLocationId"
    | "zoneId"
    | "zoneName"
    | "locationMatchStatus"
  >,
>(
  records: T[],
  payload: {
    updatedRecordIds: string[];
    displayName: string;
    deliveryLocationId: string;
    zoneId: string | null;
    zoneName: string | null;
  },
): T[] {
  const idSet = new Set(payload.updatedRecordIds);
  return records.map((record) =>
    idSet.has(record.id)
      ? {
          ...record,
          city: payload.displayName,
          updatedDeliveryLocation: payload.displayName,
          deliveryLocationId: payload.deliveryLocationId,
          zoneId: payload.zoneId,
          zoneName: payload.zoneName,
          locationMatchStatus: "MANUALLY_FIXED" as const,
        }
      : record,
  );
}
