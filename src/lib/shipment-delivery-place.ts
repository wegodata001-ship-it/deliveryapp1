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
  const original = shipmentOriginalDeliveryPlace(input);

  const updated =
    input.updatedDeliveryPlace?.trim() ||
    input.resolvedDeliveryPlace?.trim() ||
    input.updatedDeliveryLocation?.trim() ||
    null;
  if (updated && (!original || updated !== original)) return updated;

  if (input.locationMatchStatus === "MANUALLY_FIXED" && input.city?.trim()) {
    return input.city.trim();
  }

  const city = input.city?.trim() || null;
  if (city && original && city !== original) {
    return city;
  }

  return original || city;
}

export type EffectiveDeliveryAddress = {
  /** כתובת מסירה מלאה לתצוגה: רחוב + מקום א.effective */
  display: string;
  street: string | null;
  place: string | null;
  originalDisplay: string;
  originalPlace: string | null;
  isPlaceUpdated: boolean;
};

function joinStreetAndPlace(street: string | null, place: string | null): string {
  const parts = [street, place].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

/** SSOT לכתובת מסירה מלאה (רחוב + מקום) — לכל מסך תפעולי */
export function getEffectiveDeliveryAddress(
  input: EffectiveDeliveryPlaceInput,
): EffectiveDeliveryAddress {
  const street = input.address?.trim() || null;
  const originalPlace = shipmentOriginalDeliveryPlace(input);
  const effectivePlace = getEffectiveDeliveryPlace(input);
  const originalDisplay = joinStreetAndPlace(street, originalPlace);
  const display = joinStreetAndPlace(street, effectivePlace);
  const isPlaceUpdated = Boolean(
    effectivePlace &&
      originalPlace &&
      effectivePlace.trim() !== originalPlace.trim(),
  );
  return {
    display,
    street,
    place: effectivePlace,
    originalDisplay,
    originalPlace,
    isPlaceUpdated,
  };
}

export function getEffectiveDeliveryAddressFromRecord(
  record: Pick<
    ShipmentRecordDto,
    | "address"
    | "updatedDeliveryLocation"
    | "originalDeliveryLocation"
    | "city"
    | "locationMatchStatus"
  >,
): EffectiveDeliveryAddress {
  return getEffectiveDeliveryAddress({
    address: record.address,
    originalDeliveryLocation: record.originalDeliveryLocation,
    updatedDeliveryLocation: record.updatedDeliveryLocation,
    city: record.city,
    locationMatchStatus: record.locationMatchStatus,
  });
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
