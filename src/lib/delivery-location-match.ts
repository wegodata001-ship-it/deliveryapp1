import { prisma } from "@/lib/prisma";
import { aliasLookupKey, normalizeLocationName } from "@/lib/delivery-location-normalize";

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
 * התאמה זהירה:
 * 1) התאמה מדויקת לפי מפתח מנורמל
 * 2) ניסיון לחלץ שם יישוב מכתובת מלאה — רק אם יש יישוב יחיד שמתאים כ-substring
 * 3) במקרה של ספק — UNMATCHED (ללא שיוך אזור)
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
  const byKey = new Map<string, AliasCacheRow>();
  for (const row of rows) {
    const key = row.normalizedOriginalName || aliasLookupKey(row.originalName);
    if (key) byKey.set(key, row);
    const norm = normalizeLocationName(row.originalName);
    if (norm) byKey.set(norm, row);
  }

  const tryExact = (raw: string): AliasCacheRow | null => {
    const key = aliasLookupKey(raw);
    const norm = normalizeLocationName(raw);
    return (key ? byKey.get(key) : null) ?? (norm ? byKey.get(norm) : null) ?? null;
  };

  if (cityRaw) {
    const exact = tryExact(cityRaw);
    if (exact) return toResolved("MATCHED", cityRaw, exact);
  }

  // ניסיון מכתובת / מחרוזת מלאה: substring זהיר — רק התאמה יחידה ברורה
  const haystack = normalizeLocationName(cityRaw || addressRaw || "");
  if (haystack) {
    const hits: AliasCacheRow[] = [];
    const seenLocations = new Set<string>();
    for (const row of rows) {
      const needle = row.normalizedOriginalName;
      if (!needle || needle.length < 4) continue;
      if (haystack === needle || haystack.includes(` ${needle} `) || haystack.endsWith(` ${needle}`) || haystack.startsWith(`${needle} `) || haystack.endsWith(needle) || haystack === needle) {
        if (!seenLocations.has(row.deliveryLocationId)) {
          seenLocations.add(row.deliveryLocationId);
          hits.push(row);
        }
      } else if (haystack.includes(needle)) {
        if (!seenLocations.has(row.deliveryLocationId)) {
          seenLocations.add(row.deliveryLocationId);
          hits.push(row);
        }
      }
    }

    if (hits.length === 1) {
      return toResolved("MATCHED", originalName, hits[0]);
    }

    if (hits.length > 1) {
      const best = [...hits].sort(
        (a, b) => b.normalizedOriginalName.length - a.normalizedOriginalName.length,
      )[0];
      return {
        status: "UNMATCHED",
        originalName,
        city: cityRaw || originalName,
        deliveryLocationId: null,
        zoneId: null,
        zoneName: null,
        suggestionDisplayName: best.displayName,
      };
    }
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
  // warm cache once
  await loadAliasCache();
  const results: ResolvedDeliveryLocation[] = [];
  for (const row of rows) {
    results.push(await resolveDeliveryLocation(row));
  }
  return results;
}
