export type ShipmentImportLocationMapping = {
  originalPlace: string;
  updatedPlace: string;
  deliveryLocationId: string | null;
  zoneId: string | null;
  zoneName: string | null;
};

function placeKey(value: string): string {
  return value.trim();
}

export function applyImportLocationMappingsToRows<
  T extends {
    originalDeliveryPlace?: string | null;
    city?: string | null;
    address?: string | null;
    resolvedDeliveryPlace?: string | null;
    deliveryLocationId?: string | null;
    zoneId?: string | null;
    zoneName?: string | null;
    locationMatchStatus?: "MATCHED" | "UNMATCHED" | "MANUALLY_FIXED" | null;
  },
>(rows: T[], mappings: ShipmentImportLocationMapping[]): T[] {
  const byOriginal = new Map(mappings.map((m) => [placeKey(m.originalPlace), m]));

  return rows.map((row) => {
    const orig =
      row.originalDeliveryPlace?.trim() ||
      row.city?.trim() ||
      row.address?.trim() ||
      null;
    if (!orig) return row;
    const mapping = byOriginal.get(placeKey(orig));
    if (!mapping) return row;

    return {
      ...row,
      originalDeliveryPlace: orig,
      city: mapping.updatedPlace,
      resolvedDeliveryPlace: mapping.updatedPlace,
      deliveryLocationId: mapping.deliveryLocationId,
      zoneId: mapping.zoneId,
      zoneName: mapping.zoneName,
      locationMatchStatus: "MATCHED",
    };
  });
}

export function enrichExcelPreviewRows<
  T extends {
    city?: string | null;
    address?: string | null;
    originalDeliveryPlace?: string | null;
  },
>(rows: T[]): T[] {
  return rows.map((row) => {
    const original =
      row.originalDeliveryPlace?.trim() ||
      row.city?.trim() ||
      row.address?.trim() ||
      null;
    return {
      ...row,
      originalDeliveryPlace: original,
      city: original ?? row.city ?? null,
    };
  });
}
