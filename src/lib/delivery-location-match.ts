import { prisma } from "@/lib/prisma";
import {
  aliasLookupKey,
  locationNamesMatch,
  normalizeLocationName,
} from "@/lib/delivery-location-normalize";

export type LocationMatchStatusValue = "MATCHED" | "UNMATCHED" | "MANUALLY_FIXED";

export type ResolvedDeliveryLocation = {
  status: LocationMatchStatusValue;
  originalName: string | null;
  city: string | null;
  deliveryLocationId: string | null;
  zoneId: string | null;
  zoneName: string | null;
  /** הצעה בלבד — לא להחיל אוטומטית */
  suggestionDisplayName: string | null;
};

type AliasCacheRow = {
  id: string;
  originalName: string;
  normalizedOriginalName: string;
  deliveryLocationId: string;
  displayName: string;
  distributionAreaId: string | null;
  zoneName: string | null;
  zoneIsActive: boolean;
  locationActive: boolean;
};

export type AliasLookupMaps = {
  byCompactKey: Map<string, AliasCacheRow>;
  byNormalized: Map<string, AliasCacheRow>;
};

export type ShipmentDeliveryLocationInput = {
  originalDeliveryLocation?: string | null;
  city?: string | null;
  address?: string | null;
  deliveryLocationId?: string | null;
  deliveryLocation?: { displayName: string } | null;
};

/** שם מקום מסירה מקורי מהמשלוח (לפני התאמה) */
export function shipmentOriginalDeliveryLocationName(
  input: Pick<ShipmentDeliveryLocationInput, "originalDeliveryLocation" | "city" | "address">,
): string | null {
  return (
    input.originalDeliveryLocation?.trim() ||
    input.city?.trim() ||
    input.address?.trim() ||
    null
  );
}

function registerAliasKey(
  maps: AliasLookupMaps,
  raw: string | null | undefined,
  row: AliasCacheRow,
): void {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return;
  const compact = aliasLookupKey(trimmed);
  const norm = normalizeLocationName(trimmed);
  if (compact && !maps.byCompactKey.has(compact)) maps.byCompactKey.set(compact, row);
  if (norm && !maps.byNormalized.has(norm)) maps.byNormalized.set(norm, row);
}

export function buildAliasLookupMap(rows: AliasCacheRow[]): AliasLookupMaps {
  const maps: AliasLookupMaps = {
    byCompactKey: new Map(),
    byNormalized: new Map(),
  };
  for (const row of rows) {
    registerAliasKey(maps, row.originalName, row);
    registerAliasKey(maps, row.displayName, row);
    registerAliasKey(maps, row.normalizedOriginalName, row);
  }
  return maps;
}

export async function loadAliasLookupMap(): Promise<AliasLookupMaps> {
  const rows = await loadAliasCache();
  return buildAliasLookupMap(rows);
}

/**
 * SSOT לתצוגת «מקום מסירה מעודכן»:
 * 1) טבלת כינויים (DeliveryLocationAlias → DeliveryLocation.displayName)
 * 2) FK ל-DeliveryLocation (גיבוי)
 * 3) שם מקורי מהמשלוח
 */
/** מקור ייבוא קשיח — לא city/address (עלולים להיות מלוכלכים). */
export function shipmentStrictOriginalDeliveryLocation(
  input: Pick<ShipmentDeliveryLocationInput, "originalDeliveryLocation">,
): string | null {
  return input.originalDeliveryLocation?.trim() || null;
}

export function resolveUpdatedDeliveryLocationDisplay(
  input: ShipmentDeliveryLocationInput,
  maps: AliasLookupMaps,
): string | null {
  const strictOriginal = shipmentStrictOriginalDeliveryLocation(input);
  const lookupKey = strictOriginal || shipmentOriginalDeliveryLocationName(input);

  if (lookupKey) {
    const hit = lookupAliasRow(lookupKey, maps);
    const mapped = hit?.displayName?.trim();
    if (mapped && (!strictOriginal || mapped !== strictOriginal)) return mapped;
  }

  const fromFk = input.deliveryLocation?.displayName?.trim();
  if (fromFk && (!strictOriginal || fromFk !== strictOriginal)) return fromFk;

  return null;
}

let aliasCache: { loadedAt: number; rows: AliasCacheRow[] } | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateDeliveryLocationAliasCache() {
  aliasCache = null;
}

async function loadAliasCache(): Promise<AliasCacheRow[]> {
  const now = Date.now();
  if (aliasCache && now - aliasCache.loadedAt < CACHE_TTL_MS) {
    return aliasCache.rows;
  }
  const aliases = await prisma.deliveryLocationAlias.findMany({
    where: { isActive: true },
    select: {
      id: true,
      originalName: true,
      normalizedOriginalName: true,
      deliveryLocationId: true,
      deliveryLocation: {
        select: {
          displayName: true,
          isActive: true,
          distributionAreaId: true,
          distributionArea: { select: { name: true, isActive: true } },
        },
      },
    },
  });
  const rows: AliasCacheRow[] = aliases
    .filter((a) => a.deliveryLocation.isActive)
    .map((a) => ({
      id: a.id,
      originalName: a.originalName,
      normalizedOriginalName: a.normalizedOriginalName,
      deliveryLocationId: a.deliveryLocationId,
      displayName: a.deliveryLocation.displayName,
      distributionAreaId: a.deliveryLocation.distributionAreaId,
      zoneName: a.deliveryLocation.distributionArea?.name ?? null,
      zoneIsActive: a.deliveryLocation.distributionArea?.isActive ?? false,
      locationActive: a.deliveryLocation.isActive,
    }));
  aliasCache = { loadedAt: now, rows };
  return rows;
}

function toResolved(
  status: LocationMatchStatusValue,
  originalName: string | null,
  row: AliasCacheRow | null,
  suggestionDisplayName: string | null = null,
): ResolvedDeliveryLocation {
  if (!row) {
    return {
      status,
      originalName,
      city: originalName,
      deliveryLocationId: null,
      zoneId: null,
      zoneName: null,
      suggestionDisplayName,
    };
  }
  const assignZone = Boolean(row.distributionAreaId && row.zoneIsActive);
  return {
    status,
    originalName,
    city: row.displayName,
    deliveryLocationId: row.deliveryLocationId,
    zoneId: assignZone ? row.distributionAreaId : null,
    zoneName: row.zoneName,
    suggestionDisplayName,
  };
}

/**
 * חיפוש Alias לפי סדר:
 * 1) התאמה מדויקת (normalized)
 * 2) מפתח קומפקטי (ללא רווחים/מקפים, case-insensitive ללatin)
 * 3) locationNamesMatch על כל alias (גיבוי)
 */
export function lookupAliasRow(raw: string, maps: AliasLookupMaps): AliasCacheRow | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const norm = normalizeLocationName(trimmed);
  if (norm) {
    const byNorm = maps.byNormalized.get(norm);
    if (byNorm) return byNorm;
  }

  const compact = aliasLookupKey(trimmed);
  if (compact) {
    const byCompact = maps.byCompactKey.get(compact);
    if (byCompact) return byCompact;
  }

  for (const row of maps.byCompactKey.values()) {
    if (locationNamesMatch(trimmed, row.originalName) || locationNamesMatch(trimmed, row.displayName)) {
      return row;
    }
  }

  return null;
}

function substringMatch(
  haystackRaw: string,
  maps: AliasLookupMaps,
): { hit: AliasCacheRow | null; suggestion: string | null } {
  const hayCompact = aliasLookupKey(haystackRaw);
  if (!hayCompact || hayCompact.length < 4) return { hit: null, suggestion: null };

  const hits: AliasCacheRow[] = [];
  const seen = new Set<string>();

  for (const row of maps.byCompactKey.values()) {
    const needle = aliasLookupKey(row.originalName) || aliasLookupKey(row.displayName);
    if (!needle || needle.length < 4) continue;
    if (hayCompact.includes(needle) || needle.includes(hayCompact)) {
      if (!seen.has(row.deliveryLocationId)) {
        seen.add(row.deliveryLocationId);
        hits.push(row);
      }
    }
  }

  if (hits.length === 1) return { hit: hits[0]!, suggestion: null };

  if (hits.length > 1) {
    const best = [...hits].sort(
      (a, b) =>
        aliasLookupKey(b.originalName).length - aliasLookupKey(a.originalName).length,
    )[0]!;
    return { hit: null, suggestion: best.displayName };
  }

  return { hit: null, suggestion: null };
}

/**
 * התאמה חכמה — לא תלויה בשפה / איות / רווחים / מקפים.
 * אם לא נמצא — UNMATCHED (לא זורק שגיאה).
 */
export async function resolveDeliveryLocation(input: {
  city?: string | null;
  address?: string | null;
}): Promise<ResolvedDeliveryLocation> {
  const cityRaw = (input.city ?? "").trim() || null;
  const addressRaw = (input.address ?? "").trim() || null;
  const originalName = cityRaw || addressRaw;

  if (!originalName) {
    return {
      status: "UNMATCHED",
      originalName: null,
      city: null,
      deliveryLocationId: null,
      zoneId: null,
      zoneName: null,
      suggestionDisplayName: null,
    };
  }

  const rows = await loadAliasCache();
  const maps = buildAliasLookupMap(rows);

  if (cityRaw) {
    const exact = lookupAliasRow(cityRaw, maps);
    if (exact) return toResolved("MATCHED", cityRaw, exact);
  }

  if (addressRaw && addressRaw !== cityRaw) {
    const fromAddress = lookupAliasRow(addressRaw, maps);
    if (fromAddress) return toResolved("MATCHED", addressRaw, fromAddress);
  }

  const sub = substringMatch(cityRaw || addressRaw || "", maps);
  if (sub.hit) return toResolved("MATCHED", originalName, sub.hit);
  if (sub.suggestion) {
    return {
      status: "UNMATCHED",
      originalName,
      city: cityRaw || originalName,
      deliveryLocationId: null,
      zoneId: null,
      zoneName: null,
      suggestionDisplayName: sub.suggestion,
    };
  }

  return {
    status: "UNMATCHED",
    originalName,
    city: cityRaw || originalName,
    deliveryLocationId: null,
    zoneId: null,
    zoneName: null,
    suggestionDisplayName: null,
  };
}

export async function resolveDeliveryLocationsForRows(
  rows: Array<{ city?: string | null; address?: string | null }>,
): Promise<ResolvedDeliveryLocation[]> {
  await loadAliasCache();
  const results: ResolvedDeliveryLocation[] = [];
  for (const row of rows) {
    results.push(await resolveDeliveryLocation(row));
  }
  return results;
}
