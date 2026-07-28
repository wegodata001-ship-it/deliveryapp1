import { prisma } from "@/lib/prisma";
import { aliasLookupKey, normalizeLocationName } from "@/lib/delivery-location-normalize";
import { invalidateDeliveryLocationAliasCache } from "@/lib/delivery-location-match";
import {
  looksLikeDistributionArea,
  looksLikeLocalityName,
  normalizeDistributionAreaName,
} from "@/lib/distribution-area-name";

export type DeliveryLocationDto = {
  id: string;
  displayName: string;
  distributionAreaId: string | null;
  distributionAreaName: string | null;
  isActive: boolean;
  aliasCount: number;
  aliases: Array<{
    id: string;
    originalName: string;
    normalizedOriginalName: string;
    isActive: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type LocationAliasImportRow = {
  rowIndex: number;
  originalName: string;
  displayName: string;
  areaName: string | null;
  valid: boolean;
  error: string | null;
};

export type LocationAliasImportPreview = {
  rows: LocationAliasImportRow[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  missingAreaRows: number;
  wouldCreateLocations: number;
  wouldCreateAliases: number;
  wouldUpdateAliases: number;
  wouldCreateAreas: number;
  /** אינדקס שורת הכותרות בקובץ (0-based), או -1 אם לא נמצאה */
  headerRowIndex: number;
  /** מיפוי עמודות לפי כותרת — חובה לפני ייבוא */
  columnMap: {
    originalIdx: number;
    areaIdx: number;
    updatedIdx: number;
  } | null;
  /** אם לא ריק — אסור לייבא */
  mappingError: string | null;
};

export type LocationAliasImportResult = {
  totalRows: number;
  processed: number;
  createdLocations: number;
  updatedLocations: number;
  createdAliases: number;
  updatedAliases: number;
  createdAreas: number;
  failed: number;
  missingArea: number;
  errors: Array<{ rowIndex: number; error: string }>;
};

function mapLocation(loc: {
  id: string;
  displayName: string;
  distributionAreaId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  distributionArea: { name: string } | null;
  aliases: Array<{
    id: string;
    originalName: string;
    normalizedOriginalName: string;
    isActive: boolean;
  }>;
}): DeliveryLocationDto {
  return {
    id: loc.id,
    displayName: loc.displayName,
    distributionAreaId: loc.distributionAreaId,
    distributionAreaName: loc.distributionArea?.name ?? null,
    isActive: loc.isActive,
    aliasCount: loc.aliases.length,
    aliases: loc.aliases.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      normalizedOriginalName: a.normalizedOriginalName,
      isActive: a.isActive,
    })),
    createdAt: loc.createdAt.toISOString(),
    updatedAt: loc.updatedAt.toISOString(),
  };
}

export async function listDeliveryLocations(opts?: {
  search?: string;
  areaId?: string;
  includeInactive?: boolean;
}): Promise<DeliveryLocationDto[]> {
  const search = opts?.search?.trim();
  const locations = await prisma.deliveryLocation.findMany({
    where: {
      ...(opts?.includeInactive ? {} : { isActive: true }),
      ...(opts?.areaId ? { distributionAreaId: opts.areaId } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              {
                aliases: {
                  some: {
                    OR: [
                      { originalName: { contains: search, mode: "insensitive" } },
                      { normalizedOriginalName: { contains: normalizeLocationName(search) } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      distributionArea: { select: { name: true } },
      aliases: {
        where: { isActive: true },
        orderBy: { originalName: "asc" },
      },
    },
    orderBy: { displayName: "asc" },
  });
  return locations.map(mapLocation);
}

/** מציאת יישוב קיים לפי שם מדויק או מפתח מנורמל — למניעת כפילויות בטבלת האב */
async function findExistingDeliveryLocationId(displayName: string): Promise<string | null> {
  const name = displayName.trim();
  if (!name) return null;
  const exact = await prisma.deliveryLocation.findUnique({
    where: { displayName: name },
    select: { id: true },
  });
  if (exact) return exact.id;

  const key = aliasLookupKey(name);
  if (!key) return null;
  const all = await prisma.deliveryLocation.findMany({
    select: { id: true, displayName: true },
    take: 5000,
  });
  const hit = all.find((l) => aliasLookupKey(l.displayName) === key);
  return hit?.id ?? null;
}

export async function createDeliveryLocation(input: {
  displayName: string;
  distributionAreaId?: string | null;
}): Promise<DeliveryLocationDto> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("שם יישוב חובה");
  if (looksLikeDistributionArea(displayName)) {
    throw new Error("זה נראה כאזור חלוקה — יש ליצור אותו תחת ניהול אזורי חלוקה, לא כיישוב");
  }
  if (input.distributionAreaId) {
    const area = await prisma.shipmentDeliveryZone.findUnique({
      where: { id: input.distributionAreaId },
      select: { id: true, isActive: true },
    });
    if (!area) throw new Error("אזור החלוקה לא נמצא");
  }
  const existingId = await findExistingDeliveryLocationId(displayName);
  if (existingId) {
    const updated = await prisma.deliveryLocation.update({
      where: { id: existingId },
      data: {
        isActive: true,
        ...(input.distributionAreaId !== undefined
          ? { distributionAreaId: input.distributionAreaId }
          : {}),
      },
      include: {
        distributionArea: { select: { name: true } },
        aliases: { where: { isActive: true }, orderBy: { originalName: "asc" } },
      },
    });
    invalidateDeliveryLocationAliasCache();
    return mapLocation(updated);
  }
  const created = await prisma.deliveryLocation.create({
    data: {
      displayName,
      distributionAreaId: input.distributionAreaId ?? null,
    },
    include: {
      distributionArea: { select: { name: true } },
      aliases: true,
    },
  });
  invalidateDeliveryLocationAliasCache();
  return mapLocation(created);
}

export async function updateDeliveryLocation(input: {
  id: string;
  displayName?: string;
  distributionAreaId?: string | null;
  isActive?: boolean;
}): Promise<void> {
  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) data.displayName = input.displayName.trim();
  if (input.distributionAreaId !== undefined) data.distributionAreaId = input.distributionAreaId;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  await prisma.deliveryLocation.update({ where: { id: input.id }, data });
  invalidateDeliveryLocationAliasCache();
}

export async function bulkAssignLocationsToArea(input: {
  locationIds: string[];
  distributionAreaId: string | null;
}): Promise<number> {
  const result = await prisma.deliveryLocation.updateMany({
    where: { id: { in: input.locationIds } },
    data: { distributionAreaId: input.distributionAreaId },
  });
  invalidateDeliveryLocationAliasCache();
  return result.count;
}

/** מחיקת כל אזורי החלוקה + ניתוק שיוכים (לא מוחק יישובים/כינויים) */
export async function purgeAllDistributionZones(): Promise<number> {
  const count = await prisma.shipmentDeliveryZone.count();
  await prisma.$transaction(async (tx) => {
    await tx.shipmentRecord.updateMany({ data: { zoneId: null } });
    await tx.deliveryLocation.updateMany({ data: { distributionAreaId: null } });
    await tx.shipmentDeliveryZone.deleteMany({});
  });
  invalidateDeliveryLocationAliasCache();
  return count;
}

export type AliasMappingRow = {
  aliasId: string;
  originalName: string;
  displayName: string;
  locationId: string;
  distributionAreaId: string | null;
  distributionAreaName: string | null;
  isActive: boolean;
};

/** טבלת התאמות שטוחה — כינוי → יישוב → אזור */
export async function listAliasMappingRows(opts?: {
  search?: string;
  includeInactive?: boolean;
}): Promise<AliasMappingRow[]> {
  const q = opts?.search?.trim();
  const aliases = await prisma.deliveryLocationAlias.findMany({
    where: {
      ...(opts?.includeInactive ? {} : { isActive: true }),
      ...(q
        ? {
            OR: [
              { originalName: { contains: q, mode: "insensitive" } },
              { normalizedOriginalName: { contains: normalizeLocationName(q) } },
              {
                deliveryLocation: {
                  OR: [
                    { displayName: { contains: q, mode: "insensitive" } },
                    {
                      distributionArea: {
                        name: { contains: q, mode: "insensitive" },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    include: {
      deliveryLocation: {
        include: { distributionArea: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ deliveryLocation: { displayName: "asc" } }, { originalName: "asc" }],
  });

  return aliases.map((a) => ({
    aliasId: a.id,
    originalName: a.originalName,
    displayName: a.deliveryLocation.displayName,
    locationId: a.deliveryLocationId,
    distributionAreaId: a.deliveryLocation.distributionAreaId,
    distributionAreaName: a.deliveryLocation.distributionArea?.name ?? null,
    isActive: a.isActive,
  }));
}

/**
 * ניקוי בטוח אחרי ייבוא שגוי:
 * - מוחק אזורים שנראים כיישובים (תל אביב, רמלה…)
 * - מוחק "יישובים" שנראים כאזורי חלוקה (צפון 16 שנוצר כ־DeliveryLocation)
 * - לא מוחק יישובים אמיתיים וכינויים שלהם
 */
export async function cleanupMisimportedAreasAndLocations(): Promise<{
  deletedFakeZones: number;
  deletedZoneNamedLocations: number;
  keptRealZones: number;
  keptLocalities: number;
}> {
  const zones = await prisma.shipmentDeliveryZone.findMany({
    select: { id: true, name: true },
  });
  const fakeZoneIds = zones.filter((z) => !looksLikeDistributionArea(z.name)).map((z) => z.id);
  const realZones = zones.filter((z) => looksLikeDistributionArea(z.name));

  if (fakeZoneIds.length > 0) {
    await prisma.shipmentRecord.updateMany({
      where: { zoneId: { in: fakeZoneIds } },
      data: { zoneId: null },
    });
    await prisma.deliveryLocation.updateMany({
      where: { distributionAreaId: { in: fakeZoneIds } },
      data: { distributionAreaId: null },
    });
    await prisma.shipmentDeliveryZone.deleteMany({ where: { id: { in: fakeZoneIds } } });
  }

  const locations = await prisma.deliveryLocation.findMany({
    select: { id: true, displayName: true },
  });
  const junkNames = new Set([
    "אזור חלוקה",
    "מקום מסירה",
    "מקום מסירה מעודכן",
    "מקומות מסירה",
    "דרך",
    "במשרד",
    "יתרת פתיחה",
  ]);
  const zoneNamedLocIds = locations
    .filter(
      (l) =>
        looksLikeDistributionArea(l.displayName) ||
        junkNames.has(l.displayName.trim()),
    )
    .map((l) => l.id);

  if (zoneNamedLocIds.length > 0) {
    await prisma.shipmentRecord.updateMany({
      where: { deliveryLocationId: { in: zoneNamedLocIds } },
      data: { deliveryLocationId: null, locationMatchStatus: "UNMATCHED" },
    });
    await prisma.deliveryLocationAlias.deleteMany({
      where: { deliveryLocationId: { in: zoneNamedLocIds } },
    });
    await prisma.deliveryLocationAudit.deleteMany({
      where: { deliveryLocationId: { in: zoneNamedLocIds } },
    });
    await prisma.deliveryLocation.deleteMany({ where: { id: { in: zoneNamedLocIds } } });
  }

  invalidateDeliveryLocationAliasCache();

  return {
    deletedFakeZones: fakeZoneIds.length,
    deletedZoneNamedLocations: zoneNamedLocIds.length,
    keptRealZones: realZones.length,
    keptLocalities: locations.length - zoneNamedLocIds.length,
  };
}

/** מחיקת התאמה (כינוי) — soft deactivate, ללא מחיקת היסטוריית משלוחים */
export async function deactivateLocationAlias(aliasId: string): Promise<void> {
  await prisma.deliveryLocationAlias.update({
    where: { id: aliasId },
    data: { isActive: false },
  });
  invalidateDeliveryLocationAliasCache();
}

async function loadAliasMappingRow(aliasId: string): Promise<AliasMappingRow | null> {
  const a = await prisma.deliveryLocationAlias.findUnique({
    where: { id: aliasId },
    include: {
      deliveryLocation: {
        include: { distributionArea: { select: { id: true, name: true } } },
      },
    },
  });
  if (!a) return null;
  return {
    aliasId: a.id,
    originalName: a.originalName,
    displayName: a.deliveryLocation.displayName,
    locationId: a.deliveryLocationId,
    distributionAreaId: a.deliveryLocation.distributionAreaId,
    distributionAreaName: a.deliveryLocation.distributionArea?.name ?? null,
    isActive: a.isActive,
  };
}

/**
 * עדכון שורת התאמה (Master): מקום מעודכן + אזור חלוקה.
 * מקום מסירה מקורי נשאר ללא שינוי.
 */
export async function updateAliasMapping(input: {
  aliasId: string;
  /** מקום מסירה מעודכן — בחירה קיימת או שם חדש */
  displayName: string;
  deliveryLocationId?: string | null;
  distributionAreaId?: string | null;
}): Promise<AliasMappingRow> {
  const alias = await prisma.deliveryLocationAlias.findUnique({
    where: { id: input.aliasId },
    select: { id: true, originalName: true, deliveryLocationId: true },
  });
  if (!alias) throw new Error("ההתאמה לא נמצאה");

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("מקום מסירה מעודכן חובה");
  if (looksLikeDistributionArea(displayName)) {
    throw new Error("מקום מסירה מעודכן לא יכול להיות אזור חלוקה");
  }

  let locationId = input.deliveryLocationId?.trim() || null;
  if (locationId) {
    const exists = await prisma.deliveryLocation.findUnique({
      where: { id: locationId },
      select: { id: true, displayName: true },
    });
    if (!exists) throw new Error("היישוב שנבחר לא נמצא");
    await updateDeliveryLocation({
      id: locationId,
      ...(displayName !== exists.displayName ? { displayName } : {}),
      distributionAreaId: input.distributionAreaId,
      isActive: true,
    });
  } else {
    const existingId = await findExistingDeliveryLocationId(displayName);
    if (existingId) {
      locationId = existingId;
      await updateDeliveryLocation({
        id: locationId,
        distributionAreaId: input.distributionAreaId,
        isActive: true,
      });
    } else {
      const created = await createDeliveryLocation({
        displayName,
        distributionAreaId: input.distributionAreaId ?? null,
      });
      locationId = created.id;
    }
  }

  await upsertLocationAlias({
    originalName: alias.originalName,
    deliveryLocationId: locationId,
  });

  const row = await loadAliasMappingRow(alias.id);
  if (!row) throw new Error("שגיאה בטעינת ההתאמה לאחר שמירה");
  return row;
}

/** יצירת התאמה חדשה בטבלת האב (מקורי → מעודכן + אזור) */
export async function createAliasMapping(input: {
  originalName: string;
  displayName: string;
  distributionAreaId?: string | null;
}): Promise<AliasMappingRow> {
  const originalName = input.originalName.trim();
  const displayName = input.displayName.trim();
  if (!originalName) throw new Error("מקום מסירה מקורי חובה");
  if (!displayName) throw new Error("מקום מסירה מעודכן חובה");
  if (looksLikeDistributionArea(displayName)) {
    throw new Error("מקום מסירה מעודכן לא יכול להיות אזור חלוקה");
  }

  const location = await createDeliveryLocation({
    displayName,
    distributionAreaId: input.distributionAreaId ?? null,
  });
  const { id: aliasId } = await upsertLocationAlias({
    originalName,
    deliveryLocationId: location.id,
  });
  const row = await loadAliasMappingRow(aliasId);
  if (!row) throw new Error("שגיאה ביצירת ההתאמה");
  return row;
}

export async function upsertLocationAlias(input: {
  originalName: string;
  deliveryLocationId: string;
  createdBy?: string | null;
}): Promise<{ created: boolean; id: string }> {
  const originalName = input.originalName.trim();
  if (!originalName) throw new Error("שם מקורי חובה");
  const normalized = normalizeLocationName(originalName);
  const key = aliasLookupKey(originalName) || normalized;
  if (!key) throw new Error("שם מקורי לא תקין");

  const existing = await prisma.deliveryLocationAlias.findUnique({
    where: { normalizedOriginalName: key },
  });
  if (existing) {
    await prisma.deliveryLocationAlias.update({
      where: { id: existing.id },
      data: {
        originalName,
        deliveryLocationId: input.deliveryLocationId,
        isActive: true,
      },
    });
    invalidateDeliveryLocationAliasCache();
    return { created: false, id: existing.id };
  }
  const created = await prisma.deliveryLocationAlias.create({
    data: {
      originalName,
      normalizedOriginalName: key,
      deliveryLocationId: input.deliveryLocationId,
      createdBy: input.createdBy ?? null,
    },
  });
  invalidateDeliveryLocationAliasCache();
  return { created: true, id: created.id };
}

/** נרמול כותרת להשוואה מדויקת */
function normHeaderCell(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ORIGINAL_HEADERS = new Set([
  "מקום מסירה",
  "מקום מסירה מקורי",
  "שם שמתקבל",
  "שם מקורי",
  "original",
  "original delivery location",
]);

const AREA_HEADERS = new Set([
  "אזור חלוקה",
  "distribution area",
  "distributionarea",
  "zone",
  "area",
]);

const UPDATED_HEADERS = new Set([
  "מקום מסירה מעודכן",
  "יישוב מעודכן",
  "שם יישוב מעודכן",
  "updated delivery location",
  "updateddeliverylocation",
  "display name",
]);

/**
 * מיפוי לפי שם כותרת בלבד — לא לפי אינדקס.
 * מחפש את שורת הכותרות האמיתית בכל הקובץ (מדלג על metadata).
 *
 * כותרות נדרשות:
 * מקום מסירה | אזור חלוקה | מקום מסירה מעודכן
 */
export function parseLocationAliasImportRows(
  grid: unknown[][],
): LocationAliasImportPreview {
  const empty: LocationAliasImportPreview = {
    rows: [],
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    missingAreaRows: 0,
    wouldCreateLocations: 0,
    wouldCreateAliases: 0,
    wouldUpdateAliases: 0,
    wouldCreateAreas: 0,
    headerRowIndex: -1,
    columnMap: null,
    mappingError: "לא נמצאה שורת כותרות תקינה",
  };
  if (!grid.length) return empty;

  let headerRowIndex = -1;
  let originalIdx = -1;
  let areaIdx = -1;
  let updatedIdx = -1;

  const scanLimit = Math.min(grid.length, 40);
  for (let r = 0; r < scanLimit; r++) {
    const cells = (grid[r] ?? []).map(normHeaderCell);
    let o = -1;
    let a = -1;
    let u = -1;
    for (let c = 0; c < cells.length; c++) {
      const h = cells[c];
      if (!h) continue;
      // דיוק: "מקום מסירה מעודכן" לפני "מקום מסירה"
      if (UPDATED_HEADERS.has(h)) u = c;
      else if (ORIGINAL_HEADERS.has(h)) o = c;
      else if (AREA_HEADERS.has(h)) a = c;
    }
    if (o >= 0 && a >= 0 && u >= 0 && new Set([o, a, u]).size === 3) {
      headerRowIndex = r;
      originalIdx = o;
      areaIdx = a;
      updatedIdx = u;
      break;
    }
  }

  if (headerRowIndex < 0 || originalIdx < 0 || areaIdx < 0 || updatedIdx < 0) {
    return {
      ...empty,
      mappingError:
        "מיפוי העמודות אינו תקין. נדרשות הכותרות: מקום מסירה | אזור חלוקה | מקום מסירה מעודכן",
    };
  }

  const columnMap = { originalIdx, areaIdx, updatedIdx };
  const rows: LocationAliasImportRow[] = [];
  const skipOriginals = new Set([
    "מקומות מסירה",
    "מקום מסירה",
    "דרך",
    "במשרד",
    "יתרת פתיחה",
    "סהכ",
    'סה"כ',
    "סה״כ",
  ]);

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const line = grid[i] ?? [];
    const originalName = String(line[originalIdx] ?? "").trim();
    const areaNameRaw = String(line[areaIdx] ?? "").trim();
    const displayName = String(line[updatedIdx] ?? "").trim();
    const areaName = normalizeDistributionAreaName(areaNameRaw);

    if (!originalName && !displayName && !areaNameRaw) continue;
    if (skipOriginals.has(originalName) && !displayName) continue;
    // דילוג על שורת כותרת כפולה / ערכי כותרת שנכנסו כנתונים
    if (
      ORIGINAL_HEADERS.has(normHeaderCell(originalName)) ||
      UPDATED_HEADERS.has(normHeaderCell(displayName)) ||
      AREA_HEADERS.has(normHeaderCell(displayName)) ||
      AREA_HEADERS.has(normHeaderCell(originalName)) ||
      ORIGINAL_HEADERS.has(normHeaderCell(displayName))
    ) {
      continue;
    }

    let valid = true;
    let error: string | null = null;

    if (!originalName) {
      valid = false;
      error = "חסר מקום מסירה";
    } else if (!displayName) {
      valid = false;
      error = "חסר מקום מסירה מעודכן";
    } else if (!areaNameRaw) {
      valid = false;
      error = "חסר אזור חלוקה";
    } else if (!normalizeLocationName(originalName)) {
      valid = false;
      error = "שם מקורי לא תקין לאחר נרמול";
    } else if (looksLikeDistributionArea(displayName)) {
      // זה הבאג שראינו: דרום 1 / 1 דרום נכנס ל־updated
      valid = false;
      error = "מיפוי העמודות אינו תקין — מקום מסירה מעודכן נראה כאזור חלוקה";
    } else if (!areaName) {
      valid = false;
      error = `אזור חלוקה לא תקין ("${areaNameRaw}") — צפוי פורמט כמו דרום 1 / צפון 16`;
    } else if (!looksLikeLocalityName(displayName)) {
      valid = false;
      error = "מקום מסירה מעודכן אינו שם יישוב תקין";
    }

    rows.push({
      rowIndex: i + 1,
      originalName,
      displayName,
      areaName,
      valid,
      error,
    });
  }

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.length - validRows.length;
  const swappedCount = rows.filter(
    (r) => r.error?.includes("מיפוי העמודות אינו תקין"),
  ).length;

  let mappingError: string | null = null;
  if (rows.length === 0) {
    mappingError = "לא נמצאו שורות נתונים לאחר שורת הכותרות";
  } else if (swappedCount >= Math.max(3, Math.floor(rows.length * 0.2))) {
    mappingError =
      "מיפוי העמודות אינו תקין. בדקו שהעמודות הן: מקום מסירה | אזור חלוקה | מקום מסירה מעודכן";
  } else if (validRows.length === 0) {
    mappingError = "אין שורות תקינות לייבוא — בדקו את מיפוי העמודות והערכים";
  }

  const uniqueDisplays = new Set(validRows.map((r) => r.displayName));
  const uniqueAreas = new Set(
    validRows.map((r) => r.areaName).filter((a): a is string => Boolean(a)),
  );
  const uniqueAliases = new Set(validRows.map((r) => aliasLookupKey(r.originalName)));

  return {
    rows,
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows,
    missingAreaRows: rows.filter((r) => r.valid === false && r.error?.includes("חסר אזור")).length,
    wouldCreateLocations: uniqueDisplays.size,
    wouldCreateAliases: uniqueAliases.size,
    wouldUpdateAliases: 0,
    wouldCreateAreas: uniqueAreas.size,
    headerRowIndex,
    columnMap,
    mappingError,
  };
}

export async function previewLocationAliasImport(
  grid: unknown[][],
): Promise<LocationAliasImportPreview> {
  const preview = parseLocationAliasImportRows(grid);
  const valid = preview.rows.filter((r) => r.valid);

  const existingLocations = await prisma.deliveryLocation.findMany({
    select: { displayName: true },
  });
  const locSet = new Set(existingLocations.map((l) => l.displayName));
  const locNormSet = new Set(
    existingLocations.map((l) => aliasLookupKey(l.displayName)).filter(Boolean),
  );

  const existingAliases = await prisma.deliveryLocationAlias.findMany({
    select: { normalizedOriginalName: true },
  });
  const aliasSet = new Set(existingAliases.map((a) => a.normalizedOriginalName));

  const existingAreas = await prisma.shipmentDeliveryZone.findMany({
    select: { name: true },
  });
  const areaSet = new Set(existingAreas.map((a) => a.name));

  let wouldCreateLocations = 0;
  let wouldCreateAliases = 0;
  let wouldUpdateAliases = 0;
  let wouldCreateAreas = 0;
  const seenLoc = new Set<string>();
  const seenArea = new Set<string>();

  for (const row of valid) {
    const locKey = aliasLookupKey(row.displayName) || row.displayName;
    const exists =
      locSet.has(row.displayName) || locNormSet.has(locKey) || seenLoc.has(locKey);
    if (!exists) {
      wouldCreateLocations++;
      seenLoc.add(locKey);
    }
    const key = aliasLookupKey(row.originalName);
    if (aliasSet.has(key)) wouldUpdateAliases++;
    else wouldCreateAliases++;
    if (row.areaName && !areaSet.has(row.areaName) && !seenArea.has(row.areaName)) {
      wouldCreateAreas++;
      seenArea.add(row.areaName);
    }
  }

  return {
    ...preview,
    wouldCreateLocations,
    wouldCreateAliases,
    wouldUpdateAliases,
    wouldCreateAreas,
  };
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

/**
 * ייבוא מרוכז — בלי N+1.
 * עם DB מרוחק (~400ms לשאילתה) לולאה של 500 upserts הייתה נתקעת בדפדפן.
 */
export async function commitLocationAliasImport(
  grid: unknown[][],
  createdById: string,
): Promise<LocationAliasImportResult> {
  const preview = parseLocationAliasImportRows(grid);
  return commitLocationAliasImportRows(preview.rows, createdById, preview.totalRows);
}

export async function commitLocationAliasImportRows(
  rows: LocationAliasImportRow[],
  createdById: string,
  totalRowsHint?: number,
): Promise<LocationAliasImportResult> {
  const result: LocationAliasImportResult = {
    totalRows: totalRowsHint ?? rows.length,
    processed: 0,
    createdLocations: 0,
    updatedLocations: 0,
    createdAliases: 0,
    updatedAliases: 0,
    createdAreas: 0,
    failed: 0,
    missingArea: 0,
    errors: [],
  };

  const validRows: LocationAliasImportRow[] = [];
  for (const row of rows) {
    if (!row.valid) {
      result.failed++;
      if (result.errors.length < 50) {
        result.errors.push({ rowIndex: row.rowIndex, error: row.error ?? "שגיאה" });
      }
      continue;
    }
    validRows.push(row);
  }
  if (validRows.length === 0) return result;

  const [existingAreas, existingLocs, existingAliases] = await Promise.all([
    prisma.shipmentDeliveryZone.findMany({
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.deliveryLocation.findMany({
      select: { id: true, displayName: true, distributionAreaId: true },
    }),
    prisma.deliveryLocationAlias.findMany({
      select: {
        id: true,
        normalizedOriginalName: true,
        deliveryLocationId: true,
        originalName: true,
      },
    }),
  ]);

  const areaCache = new Map(existingAreas.map((a) => [a.name, a.id]));
  let nextSort = existingAreas.reduce((m, a) => Math.max(m, a.sortOrder), -1) + 1;
  const locationCache = new Map(existingLocs.map((l) => [l.displayName, l.id]));
  const locationByNorm = new Map<string, string>();
  for (const l of existingLocs) {
    const key = aliasLookupKey(l.displayName);
    if (key && !locationByNorm.has(key)) locationByNorm.set(key, l.id);
  }
  const locationArea = new Map(existingLocs.map((l) => [l.id, l.distributionAreaId]));
  const aliasByKey = new Map(
    existingAliases.map((a) => [a.normalizedOriginalName, a]),
  );

  function resolveLocationId(displayName: string): string | undefined {
    const exact = locationCache.get(displayName);
    if (exact) return exact;
    const key = aliasLookupKey(displayName);
    if (!key) return undefined;
    const byNorm = locationByNorm.get(key);
    if (byNorm) {
      locationCache.set(displayName, byNorm);
      return byNorm;
    }
    return undefined;
  }

  // אזורים חסרים — רק שמות שנראים כאזור חלוקה אמיתי (צפון 16 וכו')
  const areasToCreate: string[] = [];
  const seenNewArea = new Set<string>();
  for (const row of validRows) {
    if (!row.areaName || !looksLikeDistributionArea(row.areaName)) continue;
    if (areaCache.has(row.areaName) || seenNewArea.has(row.areaName)) continue;
    seenNewArea.add(row.areaName);
    areasToCreate.push(row.areaName);
  }
  if (areasToCreate.length > 0) {
    await prisma.shipmentDeliveryZone.createMany({
      data: areasToCreate.map((name, i) => ({
        name,
        sortOrder: nextSort + i,
        createdById,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    const created = await prisma.shipmentDeliveryZone.findMany({
      where: { name: { in: areasToCreate } },
      select: { id: true, name: true },
    });
    for (const a of created) areaCache.set(a.name, a.id);
    result.createdAreas = created.length;
  }

  // יישובים חסרים — יצירה מרוכזת (ללא כפילויות לפי שם מדויק או מנורמל)
  const locsToCreate: Array<{ displayName: string; distributionAreaId: string | null }> = [];
  const seenNewLoc = new Set<string>();
  for (const row of validRows) {
    if (resolveLocationId(row.displayName)) continue;
    const locKey = aliasLookupKey(row.displayName) || row.displayName;
    if (seenNewLoc.has(locKey)) {
      // שם חדש שנראה זהה לשם אחר בקובץ — נמפה לאותו displayName הראשון
      continue;
    }
    seenNewLoc.add(locKey);
    locsToCreate.push({
      displayName: row.displayName,
      distributionAreaId: row.areaName ? areaCache.get(row.areaName) ?? null : null,
    });
  }
  if (locsToCreate.length > 0) {
    await prisma.deliveryLocation.createMany({
      data: locsToCreate,
      skipDuplicates: true,
    });
    const created = await prisma.deliveryLocation.findMany({
      where: { displayName: { in: locsToCreate.map((l) => l.displayName) } },
      select: { id: true, displayName: true, distributionAreaId: true },
    });
    for (const l of created) {
      locationCache.set(l.displayName, l.id);
      const key = aliasLookupKey(l.displayName);
      if (key) locationByNorm.set(key, l.id);
      locationArea.set(l.id, l.distributionAreaId);
    }
    result.createdLocations = created.length;
  }

  // מיפוי שמות מעודכנים שנראים זהים (מנורמל) ליישוב שכבר קיים/נוצר
  for (const row of validRows) {
    resolveLocationId(row.displayName);
    if (!locationCache.has(row.displayName)) {
      const key = aliasLookupKey(row.displayName);
      if (key && locationByNorm.has(key)) {
        locationCache.set(row.displayName, locationByNorm.get(key)!);
      }
    }
  }

  // עדכון אזור ליישובים קיימים — מרוכז לפי areaId
  const locationAreaUpdates = new Map<string, string>(); // locationId -> areaId
  for (const row of validRows) {
    if (!row.areaName) {
      result.missingArea++;
      continue;
    }
    const areaId = areaCache.get(row.areaName);
    const locationId = resolveLocationId(row.displayName);
    if (!areaId || !locationId) continue;
    const current = locationArea.get(locationId) ?? null;
    if (current !== areaId) {
      locationAreaUpdates.set(locationId, areaId);
      locationArea.set(locationId, areaId);
    }
  }
  if (locationAreaUpdates.size > 0) {
    const byArea = new Map<string, string[]>();
    for (const [locId, areaId] of locationAreaUpdates) {
      const list = byArea.get(areaId) ?? [];
      list.push(locId);
      byArea.set(areaId, list);
    }
    await Promise.all(
      [...byArea.entries()].map(([areaId, ids]) =>
        prisma.deliveryLocation.updateMany({
          where: { id: { in: ids } },
          data: { distributionAreaId: areaId, isActive: true },
        }),
      ),
    );
    result.updatedLocations = locationAreaUpdates.size;
  }

  // כינויים — last-wins לפי מפתח נורמלי
  type AliasDraft = {
    originalName: string;
    key: string;
    deliveryLocationId: string;
    rowIndex: number;
  };
  const draftByKey = new Map<string, AliasDraft>();
  for (const row of validRows) {
    const locationId = resolveLocationId(row.displayName);
    if (!locationId) {
      result.failed++;
      if (result.errors.length < 50) {
        result.errors.push({ rowIndex: row.rowIndex, error: "יישוב לא נוצר" });
      }
      continue;
    }
    const key = aliasLookupKey(row.originalName);
    if (!key) {
      result.failed++;
      continue;
    }
    draftByKey.set(key, {
      originalName: row.originalName.trim(),
      key,
      deliveryLocationId: locationId,
      rowIndex: row.rowIndex,
    });
  }

  const toCreate: AliasDraft[] = [];
  const toUpdate: Array<AliasDraft & { id: string }> = [];
  for (const draft of draftByKey.values()) {
    const existing = aliasByKey.get(draft.key);
    if (!existing) toCreate.push(draft);
    else if (
      existing.deliveryLocationId !== draft.deliveryLocationId ||
      existing.originalName !== draft.originalName
    ) {
      toUpdate.push({ ...draft, id: existing.id });
    } else {
      // כבר מעודכן — נספר כ־update (idempotent)
      result.updatedAliases++;
      result.processed++;
    }
  }

  if (toCreate.length > 0) {
    await chunked(toCreate, 200, async (chunk) => {
      await prisma.deliveryLocationAlias.createMany({
        data: chunk.map((d) => ({
          originalName: d.originalName,
          normalizedOriginalName: d.key,
          deliveryLocationId: d.deliveryLocationId,
          createdBy: createdById,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    });
    result.createdAliases = toCreate.length;
    result.processed += toCreate.length;
  }

  if (toUpdate.length > 0) {
    await chunked(toUpdate, 40, async (chunk) => {
      await prisma.$transaction(
        chunk.map((d) =>
          prisma.deliveryLocationAlias.update({
            where: { id: d.id },
            data: {
              originalName: d.originalName,
              deliveryLocationId: d.deliveryLocationId,
              isActive: true,
            },
          }),
        ),
      );
    });
    result.updatedAliases += toUpdate.length;
    result.processed += toUpdate.length;
  }

  invalidateDeliveryLocationAliasCache();

  // לאחר ייבוא התאמות — רענון אזורי חלוקה למשלוחים קיימים
  try {
    await backfillShipmentDistributionZones({ onlyMissingZone: true });
  } catch (e) {
    console.error("[locations] backfill after alias import failed", e);
  }
  return result;
}

/**
 * Backfill: לכל משלוח קיים — מקום מסירה מקורי (או address/city) → התאמה → אזור חלוקה.
 * לא יוצר Snapshot יתרה; רק ממלא zoneId / city / originalDeliveryLocation.
 */
export async function backfillShipmentDistributionZones(options?: {
  batchId?: string;
  onlyMissingZone?: boolean;
  limit?: number;
}): Promise<{
  scanned: number;
  matched: number;
  updated: number;
  unmatched: number;
  skipped: number;
}> {
  const { resolveDeliveryLocation, invalidateDeliveryLocationAliasCache: bust } =
    await import("@/lib/delivery-location-match");
  bust();

  const where = {
    ...(options?.batchId ? { batchId: options.batchId } : {}),
    ...(options?.onlyMissingZone !== false
      ? {
          OR: [{ zoneId: null }, { originalDeliveryLocation: null }, { city: null }],
        }
      : {}),
  };

  const records = await prisma.shipmentRecord.findMany({
    where,
    select: {
      id: true,
      city: true,
      address: true,
      originalDeliveryLocation: true,
      zoneId: true,
      deliveryLocationId: true,
      locationMatchStatus: true,
    },
    ...(options?.limit ? { take: options.limit } : {}),
    orderBy: { createdAt: "asc" },
  });

  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  let skipped = 0;

  const CHUNK = 80;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (record) => {
        const original =
          (record.originalDeliveryLocation || "").trim() ||
          (record.city || "").trim() ||
          (record.address || "").trim() ||
          null;

        if (!original) {
          skipped++;
          return;
        }

        const match = await resolveDeliveryLocation({
          city: original,
          address: record.address,
        });

        if (match.status !== "MATCHED" || !match.zoneId) {
          unmatched++;
          // עדיין שומרים שם מקורי אם חסר — כדי שהתאמות עתידיות יעבדו
          if (!record.originalDeliveryLocation) {
            await prisma.shipmentRecord.update({
              where: { id: record.id },
              data: {
                originalDeliveryLocation: original,
                locationMatchStatus: match.status,
              },
            });
            updated++;
          }
          return;
        }

        matched++;
        const needsUpdate =
          record.zoneId !== match.zoneId ||
          record.city !== match.city ||
          record.deliveryLocationId !== match.deliveryLocationId ||
          record.originalDeliveryLocation !== match.originalName ||
          record.locationMatchStatus !== "MATCHED";

        if (!needsUpdate) {
          skipped++;
          return;
        }

        await prisma.shipmentRecord.update({
          where: { id: record.id },
          data: {
            originalDeliveryLocation: match.originalName ?? original,
            city: match.city,
            deliveryLocationId: match.deliveryLocationId,
            zoneId: match.zoneId,
            locationMatchStatus: "MATCHED",
          },
        });
        updated++;
      }),
    );
  }

  return {
    scanned: records.length,
    matched,
    updated,
    unmatched,
    skipped,
  };
}

export async function fixShipmentLocation(input: {
  recordId: string;
  deliveryLocationId?: string | null;
  newDisplayName?: string | null;
  distributionAreaId?: string | null;
  saveAsPermanentAlias?: boolean;
  changedById: string;
}): Promise<{ updatedRecordIds: string[] }> {
  const record = await prisma.shipmentRecord.findUnique({
    where: { id: input.recordId },
    select: {
      id: true,
      city: true,
      zoneId: true,
      originalDeliveryLocation: true,
      deliveryLocationId: true,
    },
  });
  if (!record) throw new Error("המשלוח לא נמצא");

  const originalName =
    record.originalDeliveryLocation || record.city || "";

  let locationId = input.deliveryLocationId ?? null;
  if (!locationId && input.newDisplayName?.trim()) {
    const created = await createDeliveryLocation({
      displayName: input.newDisplayName.trim(),
      distributionAreaId: input.distributionAreaId ?? null,
    });
    locationId = created.id;
  }
  if (!locationId) throw new Error("יש לבחור או ליצור יישוב");

  const location = await prisma.deliveryLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      displayName: true,
      distributionAreaId: true,
    },
  });
  if (!location) throw new Error("היישוב לא נמצא");

  const nextZoneId =
    input.distributionAreaId !== undefined
      ? input.distributionAreaId
      : location.distributionAreaId;

  if (input.distributionAreaId !== undefined) {
    await prisma.deliveryLocation.update({
      where: { id: locationId },
      data: { distributionAreaId: input.distributionAreaId },
    });
  }

  const saveAlias = input.saveAsPermanentAlias !== false && originalName.trim();
  if (saveAlias) {
    await upsertLocationAlias({
      originalName: originalName.trim(),
      deliveryLocationId: locationId,
      createdBy: input.changedById,
    });
  }

  // רענון כל המשלוחים הפתוחים עם אותו שם מקורי
  const originalKey = originalName.trim();
  const openStatuses = ["NEW", "RECEIVED", "ASSIGNED", "IN_TRANSIT"] as const;
  const siblings = originalKey
    ? await prisma.shipmentRecord.findMany({
        where: {
          OR: [
            { originalDeliveryLocation: originalKey },
            {
              AND: [
                { originalDeliveryLocation: null },
                { city: originalKey },
              ],
            },
          ],
          status: { in: [...openStatuses] },
        },
        select: { id: true, city: true, zoneId: true },
      })
    : [{ id: record.id, city: record.city, zoneId: record.zoneId }];

  const ids = [...new Set([record.id, ...siblings.map((s) => s.id)])];

  await prisma.shipmentRecord.updateMany({
    where: { id: { in: ids } },
    data: {
      city: location.displayName,
      deliveryLocationId: locationId,
      zoneId: nextZoneId,
      locationMatchStatus: "MANUALLY_FIXED",
    },
  });

  // שמירת השם המקורי רק היכן שחסר — בלי לדרוס ערכים קיימים
  if (originalKey) {
    await prisma.shipmentRecord.updateMany({
      where: {
        id: { in: ids },
        OR: [{ originalDeliveryLocation: null }, { originalDeliveryLocation: "" }],
      },
      data: { originalDeliveryLocation: originalKey },
    });
  }

  await prisma.deliveryLocationAudit.create({
    data: {
      shipmentRecordId: record.id,
      deliveryLocationId: locationId,
      originalName: originalKey || null,
      previousCity: record.city,
      newCity: location.displayName,
      previousZoneId: record.zoneId,
      newZoneId: nextZoneId,
      savedAsPermanentAlias: Boolean(saveAlias),
      source: "MANUAL_FIX",
      changedById: input.changedById,
    },
  });

  invalidateDeliveryLocationAliasCache();
  return { updatedRecordIds: ids };
}

export async function assignZoneWithOptionalLocationUpdate(input: {
  recordIds: string[];
  zoneId: string | null;
  updateLocationPermanently?: boolean;
  changedById: string;
}): Promise<{ updatedRecordIds: string[] }> {
  const records = await prisma.shipmentRecord.findMany({
    where: { id: { in: input.recordIds } },
    select: {
      id: true,
      city: true,
      address: true,
      zoneId: true,
      deliveryLocationId: true,
      originalDeliveryLocation: true,
    },
  });

  const updatedIds = new Set<string>(input.recordIds.filter(Boolean));
  const locationIds = [
    ...new Set(records.map((r) => r.deliveryLocationId).filter(Boolean) as string[]),
  ];

  // אם אין deliveryLocationId — ננסה למצוא יישוב לפי city / originalDeliveryLocation
  if (input.updateLocationPermanently && locationIds.length === 0) {
    const names = [
      ...new Set(
        records
          .flatMap((r) => [r.city, r.originalDeliveryLocation])
          .map((n) => n?.trim())
          .filter(Boolean) as string[],
      ),
    ];
    if (names.length) {
      const locs = await prisma.deliveryLocation.findMany({
        where: {
          OR: names.map((name) => ({
            displayName: { equals: name, mode: "insensitive" as const },
          })),
        },
        select: { id: true },
        take: 20,
      });
      for (const loc of locs) locationIds.push(loc.id);
    }
  }

  await prisma.shipmentRecord.updateMany({
    where: { id: { in: [...updatedIds] } },
    data: { zoneId: input.zoneId },
  });

  if (input.updateLocationPermanently && locationIds.length > 0) {
    await prisma.deliveryLocation.updateMany({
      where: { id: { in: locationIds } },
      data: { distributionAreaId: input.zoneId },
    });

    const siblings = await prisma.shipmentRecord.findMany({
      where: { deliveryLocationId: { in: locationIds } },
      select: {
        id: true,
        zoneId: true,
        deliveryLocationId: true,
        city: true,
        originalDeliveryLocation: true,
      },
    });
    const siblingIds = siblings.map((s) => s.id).filter((id) => !updatedIds.has(id));
    if (siblingIds.length) {
      await prisma.shipmentRecord.updateMany({
        where: { id: { in: siblingIds } },
        data: { zoneId: input.zoneId },
      });
      for (const id of siblingIds) updatedIds.add(id);
    }

    for (const record of siblings) {
      if (input.recordIds.includes(record.id)) continue;
      await prisma.deliveryLocationAudit.create({
        data: {
          shipmentRecordId: record.id,
          deliveryLocationId: record.deliveryLocationId,
          originalName: record.originalDeliveryLocation,
          previousCity: record.city,
          newCity: record.city,
          previousZoneId: record.zoneId,
          newZoneId: input.zoneId,
          savedAsPermanentAlias: true,
          source: "ZONE_UPDATE_PERMANENT_SIBLING",
          changedById: input.changedById,
        },
      });
    }

    invalidateDeliveryLocationAliasCache();
  }

  for (const record of records) {
    await prisma.deliveryLocationAudit.create({
      data: {
        shipmentRecordId: record.id,
        deliveryLocationId: record.deliveryLocationId,
        originalName: record.originalDeliveryLocation,
        previousCity: record.city,
        newCity: record.city,
        previousZoneId: record.zoneId,
        newZoneId: input.zoneId,
        savedAsPermanentAlias: Boolean(input.updateLocationPermanently),
        source: input.updateLocationPermanently
          ? "ZONE_UPDATE_PERMANENT"
          : "ZONE_UPDATE_RECORD",
        changedById: input.changedById,
      },
    });
  }

  return { updatedRecordIds: [...updatedIds] };
}

export async function reorderZones(orderedIds: string[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.shipmentDeliveryZone.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );
}
