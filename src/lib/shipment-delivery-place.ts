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

/**
 * שם מקום המסירה המקורי מהייבוא בלבד — לעולם לא city/address (עלולים להיות מלוכלכים אחרי ייבוא).
 */
export function shipmentOriginalDeliveryPlace(
  input: Pick<
    EffectiveDeliveryPlaceInput,
    "originalDeliveryPlace" | "originalDeliveryLocation"
  >,
): string | null {
  return input.originalDeliveryPlace?.trim() || input.originalDeliveryLocation?.trim() || null;
}

function resolveUpdatedDeliveryDisplay(input: EffectiveDeliveryPlaceInput): string | null {
  const original = shipmentOriginalDeliveryPlace(input);

  const fromField =
    input.updatedDeliveryLocation?.trim() ||
    input.updatedDeliveryPlace?.trim() ||
    input.resolvedDeliveryPlace?.trim() ||
    null;

  if (fromField) {
    if (!original || fromField !== original) return fromField;
  }

  if (
    input.locationMatchStatus === "MANUALLY_FIXED" &&
    input.city?.trim() &&
    original &&
    input.city.trim() !== original
  ) {
    return input.city.trim();
  }

  return null;
}

/**
 * SSOT לתצוגה ולפעולות עסקיות:
 * מקום מעודכן (אם קיים) → אחרת המקורי מהייבוא.
 */
export function getEffectiveDeliveryPlace(input: EffectiveDeliveryPlaceInput): string | null {
  const original = shipmentOriginalDeliveryPlace(input);
  const updated = resolveUpdatedDeliveryDisplay(input);
  if (updated) return updated;
  return original || input.city?.trim() || input.address?.trim() || null;
}

export type EffectiveDeliveryAddress = {
  /** כתובת מסירה לתצוגה בטבלה */
  display: string;
  street: string | null;
  place: string | null;
  originalDisplay: string;
  originalPlace: string | null;
  updatedDisplay: string | null;
  isPlaceUpdated: boolean;
};

function joinStreetAndPlace(street: string | null, place: string | null): string {
  const parts = [street, place].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function buildOriginalDisplay(
  originalPlace: string | null,
  street: string | null,
  city: string | null,
): string {
  if (originalPlace) {
    if (street && street !== originalPlace && !street.includes(originalPlace)) {
      return joinStreetAndPlace(street, originalPlace);
    }
    return originalPlace;
  }
  return street || city || "—";
}

/** SSOT לכתובת מסירה — לכל מסך תפעולי */
export function getEffectiveDeliveryAddress(
  input: EffectiveDeliveryPlaceInput,
): EffectiveDeliveryAddress {
  const street = input.address?.trim() || null;
  const city = input.city?.trim() || null;
  const originalPlace = shipmentOriginalDeliveryPlace(input);
  const updatedDisplay = resolveUpdatedDeliveryDisplay(input);
  const originalDisplay = buildOriginalDisplay(originalPlace, street, city);
  const isPlaceUpdated = Boolean(updatedDisplay);
  const display = updatedDisplay ?? originalDisplay;

  return {
    display,
    street,
    place: updatedDisplay ?? originalPlace ?? city,
    originalDisplay,
    originalPlace,
    updatedDisplay,
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
