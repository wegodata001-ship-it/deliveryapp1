export type ShipmentImportLocationMapping = {
  originalPlace: string;
  updatedPlace: string;
  deliveryLocationId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  /** ערכים שהוצעו מטבלת ההתאמות — לא משתנים בעריכה */
  suggestedUpdatedPlace?: string;
  suggestedZoneId?: string | null;
  suggestedZoneName?: string | null;
  suggestedDeliveryLocationId?: string | null;
};

function placeKey(value: string): string {
  return value.trim();
}

export function normalizeImportLocationMappings(
  mappings: ShipmentImportLocationMapping[],
): ShipmentImportLocationMapping[] {
  return mappings.map((m) => ({
    ...m,
    suggestedUpdatedPlace: m.suggestedUpdatedPlace ?? m.updatedPlace,
    suggestedZoneId: m.suggestedZoneId ?? m.zoneId,
    suggestedZoneName: m.suggestedZoneName ?? m.zoneName,
    suggestedDeliveryLocationId: m.suggestedDeliveryLocationId ?? m.deliveryLocationId,
  }));
}

export function isImportMappingManuallyEdited(m: ShipmentImportLocationMapping): boolean {
  const suggestedPlace = m.suggestedUpdatedPlace ?? m.updatedPlace;
  const suggestedZone = m.suggestedZoneId ?? m.zoneId;
  return (
    placeKey(m.updatedPlace) !== placeKey(suggestedPlace) ||
    (m.zoneId ?? null) !== (suggestedZone ?? null)
  );
}

export function restoreImportMappingToSuggested(
  m: ShipmentImportLocationMapping,
): ShipmentImportLocationMapping {
  return {
    ...m,
    updatedPlace: m.suggestedUpdatedPlace ?? m.updatedPlace,
    zoneId: m.suggestedZoneId ?? m.zoneId,
    zoneName: m.suggestedZoneName ?? m.zoneName,
    deliveryLocationId: m.suggestedDeliveryLocationId ?? m.deliveryLocationId,
  };
}

export function updateImportMappingOverride(
  mappings: ShipmentImportLocationMapping[],
  originalPlace: string,
  patch: { updatedPlace?: string; zoneId?: string | null; zoneName?: string | null },
): ShipmentImportLocationMapping[] {
  const key = placeKey(originalPlace);
  return mappings.map((m) => {
    if (placeKey(m.originalPlace) !== key) return m;
    const nextUpdated = patch.updatedPlace !== undefined ? patch.updatedPlace.trim() : m.updatedPlace;
    const nextZoneId = patch.zoneId !== undefined ? patch.zoneId : m.zoneId;
    const nextZoneName = patch.zoneName !== undefined ? patch.zoneName : m.zoneName;
    const suggestedPlace = m.suggestedUpdatedPlace ?? m.updatedPlace;
    const suggestedId = m.suggestedDeliveryLocationId ?? m.deliveryLocationId;
    const placeUnchanged = placeKey(nextUpdated) === placeKey(suggestedPlace);
    return {
      ...m,
      updatedPlace: nextUpdated,
      zoneId: nextZoneId,
      zoneName: nextZoneName,
      deliveryLocationId: placeUnchanged ? suggestedId : null,
    };
  });
}

function effectiveDeliveryLocationId(m: ShipmentImportLocationMapping): string | null {
  const suggestedPlace = m.suggestedUpdatedPlace ?? m.updatedPlace;
  const suggestedId = m.suggestedDeliveryLocationId ?? m.deliveryLocationId;
  if (placeKey(m.updatedPlace) === placeKey(suggestedPlace)) return suggestedId;
  return null;
}

function effectiveLocationMatchStatus(
  m: ShipmentImportLocationMapping,
  deliveryLocationId: string | null,
): "MATCHED" | "MANUALLY_FIXED" {
  if (deliveryLocationId) return "MATCHED";
  if (isImportMappingManuallyEdited(m)) return "MANUALLY_FIXED";
  return "MATCHED";
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
  const normalized = normalizeImportLocationMappings(mappings);
  const byOriginal = new Map(normalized.map((m) => [placeKey(m.originalPlace), m]));

  return rows.map((row) => {
    const orig =
      row.originalDeliveryPlace?.trim() ||
      row.city?.trim() ||
      row.address?.trim() ||
      null;
    if (!orig) return row;
    const mapping = byOriginal.get(placeKey(orig));
    if (!mapping) return row;

    const deliveryLocationId = effectiveDeliveryLocationId(mapping);

    return {
      ...row,
      originalDeliveryPlace: orig,
      city: mapping.updatedPlace,
      resolvedDeliveryPlace: mapping.updatedPlace,
      deliveryLocationId,
      zoneId: mapping.zoneId,
      zoneName: mapping.zoneName,
      locationMatchStatus: effectiveLocationMatchStatus(mapping, deliveryLocationId),
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

export function countImportMappingStats(mappings: ShipmentImportLocationMapping[]): {
  total: number;
  manuallyEdited: number;
  unchanged: number;
} {
  const normalized = normalizeImportLocationMappings(mappings);
  const manuallyEdited = normalized.filter(isImportMappingManuallyEdited).length;
  return {
    total: normalized.length,
    manuallyEdited,
    unchanged: normalized.length - manuallyEdited,
  };
}
