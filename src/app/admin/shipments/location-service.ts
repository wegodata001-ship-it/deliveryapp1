import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { aliasLookupKey, normalizeLocationName } from "@/lib/delivery-location-normalize";
import { invalidateDeliveryLocationAliasCache } from "@/lib/delivery-location-match";
import {
  distributionAreaLookupKey,
  distributionAreaValidationError,
  isBlockedDistributionAreaHeader,
  isValidDistributionAreaName,
  isValidLocalityDisplayName,
  sanitizeDistributionAreaName,
} from "@/lib/distribution-area-name";
import {
  inferLocationAliasImportErrorCode,
  locationAliasImportErrorLabel,
  type LocationAliasImportErrorCode,
} from "@/lib/location-import-errors";

export type { LocationAliasImportErrorCode };

export type LocationAliasImportRowAction = "create" | "update" | "noop" | "fail";
export type LocationAliasImportRowStatus = "ok" | "failed" | "warning" | "unchanged";

export type LocationAliasImportRowChanges = {
  displayName?: { before: string; after: string };
  areaName?: { before: string; after: string };
  originalName?: { before: string; after: string };
};

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
  errorCode: LocationAliasImportErrorCode | null;
  action: LocationAliasImportRowAction;
  status: LocationAliasImportRowStatus;
  warningMessage: string | null;
  changes: LocationAliasImportRowChanges | null;
};

export type LocationAliasImportNewArea = {
  name: string;
  rowCount: number;
  willCreate: boolean;
};

export type LocationAliasImportPreviewCounts = {
  total: number;
  valid: number;
  failed: number;
  warnings: number;
  unchanged: number;
  wouldCreate: number;
  wouldUpdate: number;
  newAreas: number;
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
  counts: LocationAliasImportPreviewCounts;
  newAreas: LocationAliasImportNewArea[];
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

export type LocationAliasImportRowResult = {
  rowIndex: number;
  originalName: string;
  displayName: string;
  areaName: string | null;
  success: boolean;
  action: LocationAliasImportRowAction;
  errorCode: LocationAliasImportErrorCode | null;
  error: string | null;
};

export type LocationAliasImportAudit = {
  importId: string;
  fileName: string | null;
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  warnings: number;
  newAreas: number;
  importedBy: string;
  importedAt: string;
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
  warnings: number;
  audit: LocationAliasImportAudit;
  rowResults: LocationAliasImportRowResult[];
  errors: Array<{
    rowIndex: number;
    error: string;
    errorCode: LocationAliasImportErrorCode | null;
    originalName?: string;
    displayName?: string;
    areaName?: string | null;
  }>;
};

function emptyLocationAliasImportPreview(
  mappingError: string | null = "לא נמצאה שורת כותרות תקינה",
): LocationAliasImportPreview {
  return {
    rows: [],
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    missingAreaRows: 0,
    wouldCreateLocations: 0,
    wouldCreateAliases: 0,
    wouldUpdateAliases: 0,
    wouldCreateAreas: 0,
    counts: {
      total: 0,
      valid: 0,
      failed: 0,
      warnings: 0,
      unchanged: 0,
      wouldCreate: 0,
      wouldUpdate: 0,
      newAreas: 0,
    },
    newAreas: [],
    headerRowIndex: -1,
    columnMap: null,
    mappingError,
  };
}

function buildImportRow(
  partial: Pick<
    LocationAliasImportRow,
    "rowIndex" | "originalName" | "displayName" | "areaName" | "valid" | "error"
  > &
    Partial<
      Pick<
        LocationAliasImportRow,
        "errorCode" | "action" | "status" | "warningMessage" | "changes"
      >
    >,
): LocationAliasImportRow {
  const errorCode =
    partial.errorCode ??
    (partial.valid ? null : inferLocationAliasImportErrorCode(partial.error));
  const error =
    partial.error ??
    (errorCode ? locationAliasImportErrorLabel(errorCode) : null);
  return {
    rowIndex: partial.rowIndex,
    originalName: partial.originalName,
    displayName: partial.displayName,
    areaName: partial.areaName,
    valid: partial.valid,
    error,
    errorCode,
    action: partial.action ?? (partial.valid ? "create" : "fail"),
    status: partial.status ?? (partial.valid ? "ok" : "failed"),
    warningMessage: partial.warningMessage ?? null,
    changes: partial.changes ?? null,
  };
}

function summarizeLocationAliasImportPreview(
  rows: LocationAliasImportRow[],
  newAreas: LocationAliasImportNewArea[] = [],
): Pick<
  LocationAliasImportPreview,
  | "totalRows"
  | "validRows"
  | "invalidRows"
  | "missingAreaRows"
  | "wouldCreateLocations"
  | "wouldCreateAliases"
  | "wouldUpdateAliases"
  | "wouldCreateAreas"
  | "counts"
  | "newAreas"
> {
  const totalRows = rows.length;
  const validRows = rows.filter((r) => r.valid).length;
  const invalidRows = rows.filter((r) => !r.valid).length;
  const warnings = rows.filter((r) => r.status === "warning").length;
  const unchanged = rows.filter((r) => r.action === "noop").length;
  const wouldCreate = rows.filter((r) => r.action === "create" && r.valid).length;
  const wouldUpdate = rows.filter((r) => r.action === "update" && r.valid).length;
  return {
    totalRows,
    validRows,
    invalidRows,
    missingAreaRows: rows.filter(
      (r) =>
        r.errorCode === "MISSING_DELIVERY_AREA" ||
        r.error?.includes("חסר אזור") === true,
    ).length,
    wouldCreateLocations: wouldCreate,
    wouldCreateAliases: wouldCreate,
    wouldUpdateAliases: wouldUpdate,
    wouldCreateAreas: newAreas.length,
    counts: {
      total: totalRows,
      valid: validRows,
      failed: invalidRows,
      warnings,
      unchanged,
      wouldCreate,
      wouldUpdate,
      newAreas: newAreas.length,
    },
    newAreas,
  };
}

async function persistLocationAliasImportAudit(result: LocationAliasImportResult) {
  result.audit.created = result.createdAliases;
  result.audit.updated = result.updatedAliases + result.updatedLocations;
  result.audit.failed = result.failed;
  result.audit.newAreas = result.createdAreas;
  result.audit.warnings = result.warnings;

  try {
    await prisma.auditLog.create({
      data: {
        userId: result.audit.importedBy,
        actionType: "location_alias_import",
        entityType: "LocationAliasImport",
        entityId: result.audit.importId,
        newValue: {
          summary: result.audit,
          stats: {
            processed: result.processed,
            createdLocations: result.createdLocations,
            updatedLocations: result.updatedLocations,
            createdAliases: result.createdAliases,
            updatedAliases: result.updatedAliases,
            createdAreas: result.createdAreas,
            missingArea: result.missingArea,
          },
        },
        metadata: {
          failedRows: result.errors,
          rowResults: result.rowResults.filter((r) => !r.success),
        },
      },
    });
  } catch (e) {
    console.error("[locations] audit after import failed", e);
  }
}

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
              { normalizedOriginalName: { contains: aliasLookupKey(search) || normalizeLocationName(search) } },
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
  if (!isValidLocalityDisplayName(displayName)) {
    throw new Error("שם יישוב לא תקין");
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
              { normalizedOriginalName: { contains: aliasLookupKey(q) || normalizeLocationName(q) } },
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
 * - מוחק רק שמות כותרת/שגויים (לא לפי מילות כיוון)
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
  const fakeZoneIds = zones
    .filter((z) => !isValidDistributionAreaName(z.name))
    .map((z) => z.id);
  const realZones = zones.filter((z) => isValidDistributionAreaName(z.name));

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
  const zoneNamedLocIds = locations
    .filter((l) => isBlockedDistributionAreaHeader(l.displayName))
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
  if (!isValidLocalityDisplayName(displayName)) {
    throw new Error("מקום מסירה מעודכן לא תקין");
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
  if (!isValidLocalityDisplayName(displayName)) {
    throw new Error("מקום מסירה מעודכן לא תקין");
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
        normalizedOriginalName: key,
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

/** עדכון מפתחות מנורמלים אחרי שינוי אלגוריתם הנרמול */
export async function renormalizeDeliveryLocationAliases(): Promise<number> {
  const aliases = await prisma.deliveryLocationAlias.findMany({
    where: { isActive: true },
    select: {
      id: true,
      originalName: true,
      normalizedOriginalName: true,
      deliveryLocationId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  type AliasRow = (typeof aliases)[number];
  const pendingKey = (id: string) => `__renorm__${id}`;
  const retiredKey = (id: string) => `__retired__${id}`;

  const byTarget = new Map<string, AliasRow[]>();
  for (const a of aliases) {
    const targetKey = aliasLookupKey(a.originalName);
    if (!targetKey) continue;
    const bucket = byTarget.get(targetKey) ?? [];
    bucket.push(a);
    byTarget.set(targetKey, bucket);
  }

  const winnersToUpdate = new Map<string, string>();
  const toDeactivate = new Set<string>();

  for (const [targetKey, bucket] of byTarget) {
    bucket.sort((a, b) => {
      const aMatch = a.normalizedOriginalName === targetKey ? 0 : 1;
      const bMatch = b.normalizedOriginalName === targetKey ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const [winner, ...losers] = bucket;
    if (winner.normalizedOriginalName !== targetKey) {
      winnersToUpdate.set(winner.id, targetKey);
    }
    for (const loser of losers) {
      toDeactivate.add(loser.id);
    }
  }

  const targetKeys = [...winnersToUpdate.values()];
  if (targetKeys.length === 0 && toDeactivate.size === 0) return 0;

  const inactiveBlockers =
    targetKeys.length > 0
      ? await prisma.deliveryLocationAlias.findMany({
          where: {
            isActive: false,
            normalizedOriginalName: { in: targetKeys },
          },
          select: { id: true },
        })
      : [];

  const idsNeedingPending = new Set<string>([
    ...winnersToUpdate.keys(),
    ...toDeactivate,
  ]);

  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const b of inactiveBlockers) {
      await tx.deliveryLocationAlias.update({
        where: { id: b.id },
        data: { normalizedOriginalName: retiredKey(b.id) },
      });
      updated++;
    }

    for (const id of idsNeedingPending) {
      await tx.deliveryLocationAlias.update({
        where: { id },
        data: { normalizedOriginalName: pendingKey(id) },
      });
    }

    for (const [id, targetKey] of winnersToUpdate) {
      await tx.deliveryLocationAlias.update({
        where: { id },
        data: { normalizedOriginalName: targetKey },
      });
      updated++;
    }

    for (const id of toDeactivate) {
      await tx.deliveryLocationAlias.update({
        where: { id },
        data: { isActive: false, normalizedOriginalName: retiredKey(id) },
      });
      updated++;
    }
  });

  if (updated > 0) invalidateDeliveryLocationAliasCache();
  return updated;
}

/** הוספת Alias ליישוב קיים (ללא יצירת יישוב חדש) */
export async function addLocationAlias(input: {
  deliveryLocationId: string;
  originalName: string;
  createdBy?: string | null;
}): Promise<AliasMappingRow> {
  const loc = await prisma.deliveryLocation.findUnique({
    where: { id: input.deliveryLocationId.trim() },
    select: { id: true },
  });
  if (!loc) throw new Error("יישוב לא נמצא");
  const { id: aliasId } = await upsertLocationAlias({
    originalName: input.originalName,
    deliveryLocationId: loc.id,
    createdBy: input.createdBy ?? null,
  });
  const row = await loadAliasMappingRow(aliasId);
  if (!row) throw new Error("שגיאה ביצירת הכינוי");
  return row;
}

/** עריכת שם מקורי של Alias (כל שפה) */
export async function updateLocationAliasOriginalName(input: {
  aliasId: string;
  originalName: string;
}): Promise<AliasMappingRow> {
  const alias = await prisma.deliveryLocationAlias.findUnique({
    where: { id: input.aliasId },
    select: { id: true },
  });
  if (!alias) throw new Error("הכינוי לא נמצא");
  const originalName = input.originalName.trim();
  if (!originalName) throw new Error("שם כינוי חובה");
  const key = aliasLookupKey(originalName);
  if (!key) throw new Error("שם כינוי לא תקין");
  const conflict = await prisma.deliveryLocationAlias.findUnique({
    where: { normalizedOriginalName: key },
    select: { id: true },
  });
  if (conflict && conflict.id !== alias.id) {
    throw new Error("כינוי זה כבר משויך ליישוב אחר");
  }
  await prisma.deliveryLocationAlias.update({
    where: { id: alias.id },
    data: { originalName, normalizedOriginalName: key, isActive: true },
  });
  invalidateDeliveryLocationAliasCache();
  const row = await loadAliasMappingRow(alias.id);
  if (!row) throw new Error("שגיאה בטעינת הכינוי");
  return row;
}

/** ניסיון התאמה מחדש למשלוחים שלא זוהו — אחרי הוספת Aliases */
export async function reMatchUnmatchedShipments(options?: {
  batchId?: string;
  limit?: number;
}): Promise<{ scanned: number; matched: number; updated: number }> {
  const { resolveDeliveryLocation, invalidateDeliveryLocationAliasCache: bust } =
    await import("@/lib/delivery-location-match");
  bust();

  const records = await prisma.shipmentRecord.findMany({
    where: {
      ...(options?.batchId ? { batchId: options.batchId } : {}),
      OR: [
        { locationMatchStatus: "UNMATCHED" },
        { locationMatchStatus: null },
        { deliveryLocationId: null },
      ],
    },
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

  for (const record of records) {
    const original =
      (record.originalDeliveryLocation || "").trim() ||
      (record.city || "").trim() ||
      (record.address || "").trim() ||
      null;
    if (!original) continue;

    const match = await resolveDeliveryLocation({
      city: original,
      address: record.address,
    });

    if (match.status !== "MATCHED") continue;
    matched++;

    const needsUpdate =
      record.deliveryLocationId !== match.deliveryLocationId ||
      record.city !== match.city ||
      record.zoneId !== match.zoneId ||
      record.locationMatchStatus !== "MATCHED";

    if (!needsUpdate) continue;

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
  }

  return { scanned: records.length, matched, updated };
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
  const empty = emptyLocationAliasImportPreview();
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
    return emptyLocationAliasImportPreview(
      "מיפוי העמודות אינו תקין. נדרשות הכותרות: מקום מסירה | אזור חלוקה | מקום מסירה מעודכן",
    );
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
    const areaName = sanitizeDistributionAreaName(areaNameRaw);

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
    let errorCode: LocationAliasImportErrorCode | null = null;

    if (!originalName) {
      valid = false;
      errorCode = "MISSING_SOURCE_PLACE";
      error = locationAliasImportErrorLabel(errorCode);
    } else if (!displayName) {
      valid = false;
      errorCode = "MISSING_UPDATED_PLACE";
      error = locationAliasImportErrorLabel(errorCode);
    } else if (!areaNameRaw) {
      valid = false;
      errorCode = "MISSING_DELIVERY_AREA";
      error = locationAliasImportErrorLabel(errorCode);
    } else if (!normalizeLocationName(originalName)) {
      valid = false;
      errorCode = "INVALID_SOURCE_NAME";
      error = locationAliasImportErrorLabel(errorCode);
    } else if (!areaName) {
      valid = false;
      errorCode = "INVALID_DELIVERY_AREA";
      error = `אזור חלוקה לא תקין ("${areaNameRaw}") — שם קצר מדי או שמור למערכת`;
    } else if (!isValidLocalityDisplayName(displayName)) {
      valid = false;
      errorCode = "INVALID_DISPLAY_NAME";
      error = locationAliasImportErrorLabel(errorCode);
    }

    rows.push(
      buildImportRow({
        rowIndex: i + 1,
        originalName,
        displayName,
        areaName,
        valid,
        error,
        errorCode,
        action: valid ? "create" : "fail",
        status: valid ? "ok" : "failed",
      }),
    );
  }

  let mappingError: string | null = null;
  if (rows.length === 0) {
    mappingError = "לא נמצאו שורות נתונים לאחר שורת הכותרות";
  } else if (rows.every((r) => !r.valid)) {
    mappingError = "אין שורות תקינות לייבוא — בדקו את מיפוי העמודות והערכים";
  }

  const summary = summarizeLocationAliasImportPreview(rows);

  return {
    rows,
    ...summary,
    headerRowIndex,
    columnMap,
    mappingError,
  };
}

export {
  formatLocationAliasImportCommitError,
  formatLocationAliasImportResultErrors,
  validateLocationAliasImportCommitRows,
  type LocationAliasImportCommitValidation,
} from "@/lib/location-import-commit-validation";

export async function previewLocationAliasImport(
  grid: unknown[][],
): Promise<LocationAliasImportPreview> {
  const preview = parseLocationAliasImportRows(grid);
  if (preview.mappingError || preview.rows.length === 0) return preview;

  const existingLocations = await prisma.deliveryLocation.findMany({
    select: {
      displayName: true,
      distributionAreaId: true,
      distributionArea: { select: { name: true } },
    },
  });
  const locByDisplay = new Map(existingLocations.map((l) => [l.displayName, l]));

  const existingAliases = await prisma.deliveryLocationAlias.findMany({
    select: {
      id: true,
      originalName: true,
      normalizedOriginalName: true,
      deliveryLocationId: true,
      deliveryLocation: {
        select: {
          displayName: true,
          distributionAreaId: true,
          distributionArea: { select: { name: true } },
        },
      },
    },
  });
  const aliasByKey = new Map<string, (typeof existingAliases)[number][]>();
  for (const alias of existingAliases) {
    const list = aliasByKey.get(alias.normalizedOriginalName) ?? [];
    list.push(alias);
    aliasByKey.set(alias.normalizedOriginalName, list);
  }

  const existingAreas = await prisma.shipmentDeliveryZone.findMany({
    select: { name: true },
  });
  const areaSet = new Set(existingAreas.map((a) => a.name));

  const fileAliasFirstRow = new Map<string, number>();
  const newAreaCounts = new Map<string, number>();

  const enrichedRows = preview.rows.map((row) => {
    if (!row.valid) return row;

    const key = aliasLookupKey(row.originalName);
    if (!key) {
      return buildImportRow({
        ...row,
        valid: false,
        errorCode: "INVALID_SOURCE_NAME",
        error: locationAliasImportErrorLabel("INVALID_SOURCE_NAME"),
        action: "fail",
        status: "failed",
      });
    }

    let warningMessage = row.warningMessage;
    let errorCode = row.errorCode;
    let status: LocationAliasImportRowStatus = row.status;
    if (fileAliasFirstRow.has(key)) {
      status = "warning";
      errorCode = "DUPLICATE_MAPPING";
      warningMessage =
        "נמצאה התאמה כפולה בקובץ — בעת הייבוא תישמר השורה האחרונה בלבד";
    } else {
      fileAliasFirstRow.set(key, row.rowIndex);
    }

    const aliasMatches = aliasByKey.get(key) ?? [];
    if (aliasMatches.length > 1) {
      status = "warning";
      errorCode = errorCode ?? "AMBIGUOUS_MATCH";
      warningMessage =
        warningMessage ??
        "נמצאו מספר התאמות אפשריות במערכת — יישמר לפי ההתאמה הראשונה";
    }

    if (row.areaName && !areaSet.has(row.areaName)) {
      newAreaCounts.set(row.areaName, (newAreaCounts.get(row.areaName) ?? 0) + 1);
    }

    const displayKey = aliasLookupKey(row.displayName) || row.displayName;
    const existingLoc =
      locByDisplay.get(row.displayName) ??
      existingLocations.find((l) => aliasLookupKey(l.displayName) === displayKey);
    const aliasRec = aliasMatches[0];
    let action: LocationAliasImportRowAction = "create";
    let changes: LocationAliasImportRowChanges | null = null;

    if (aliasRec) {
      const loc = aliasRec.deliveryLocation;
      const currentArea = loc.distributionArea?.name ?? null;
      const targetArea = row.areaName;
      const sameOriginal = aliasRec.originalName === row.originalName;
      const sameDisplay =
        loc.displayName === row.displayName ||
        aliasLookupKey(loc.displayName) === displayKey;
      const sameArea = currentArea === targetArea;

      if (sameOriginal && sameDisplay && sameArea) {
        action = "noop";
        if (status !== "warning") status = "unchanged";
      } else {
        action = "update";
        changes = {};
        if (!sameArea && targetArea) {
          changes.areaName = { before: currentArea ?? "—", after: targetArea };
        }
        if (!sameDisplay) {
          changes.displayName = { before: loc.displayName, after: row.displayName };
        }
        if (!sameOriginal) {
          changes.originalName = { before: aliasRec.originalName, after: row.originalName };
        }
      }
    } else if (existingLoc) {
      action = "create";
      const currentArea = existingLoc.distributionArea?.name ?? null;
      if (row.areaName && currentArea !== row.areaName) {
        changes = {
          areaName: { before: currentArea ?? "—", after: row.areaName },
        };
        action = "update";
      }
    }

    return buildImportRow({
      ...row,
      errorCode,
      action,
      status,
      warningMessage,
      changes,
    });
  });

  const newAreas: LocationAliasImportNewArea[] = [...newAreaCounts.entries()]
    .map(([name, rowCount]) => ({
      name,
      rowCount,
      willCreate: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  const summary = summarizeLocationAliasImportPreview(enrichedRows, newAreas);
  return {
    ...preview,
    rows: enrichedRows,
    ...summary,
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
  options?: { fileName?: string | null },
): Promise<LocationAliasImportResult> {
  const preview = parseLocationAliasImportRows(grid);
  return commitLocationAliasImportRows(preview.rows, createdById, preview.totalRows, options);
}

function pushLocationAliasImportFailure(
  result: LocationAliasImportResult,
  row: Pick<
    LocationAliasImportRow,
    "rowIndex" | "originalName" | "displayName" | "areaName"
  >,
  errorCode: LocationAliasImportErrorCode,
  error?: string | null,
) {
  const message = error?.trim() || locationAliasImportErrorLabel(errorCode);
  result.failed++;
  result.errors.push({
    rowIndex: row.rowIndex,
    error: message,
    errorCode,
    originalName: row.originalName,
    displayName: row.displayName,
    areaName: row.areaName,
  });
  result.rowResults.push({
    rowIndex: row.rowIndex,
    originalName: row.originalName,
    displayName: row.displayName,
    areaName: row.areaName,
    success: false,
    action: "fail",
    errorCode,
    error: message,
  });
}

export async function commitLocationAliasImportRows(
  rows: LocationAliasImportRow[],
  createdById: string,
  totalRowsHint?: number,
  options?: { fileName?: string | null },
): Promise<LocationAliasImportResult> {
  const importId = randomUUID();
  const importedAt = new Date().toISOString();
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
    warnings: rows.filter((r) => r.status === "warning").length,
    audit: {
      importId,
      fileName: options?.fileName ?? null,
      totalRows: totalRowsHint ?? rows.length,
      created: 0,
      updated: 0,
      failed: 0,
      warnings: rows.filter((r) => r.status === "warning").length,
      newAreas: 0,
      importedBy: createdById,
      importedAt,
    },
    rowResults: [],
    errors: [],
  };

  const validRows: LocationAliasImportRow[] = [];
  for (const row of rows) {
    if (!row.valid || row.status === "failed") {
      pushLocationAliasImportFailure(
        result,
        row,
        row.errorCode ?? inferLocationAliasImportErrorCode(row.error) ?? "INVALID_ROW",
        row.error,
      );
      continue;
    }
    validRows.push(row);
  }
  if (validRows.length === 0) {
    result.audit.failed = result.failed;
    await persistLocationAliasImportAudit(result);
    return result;
  }

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

  const areaCache = new Map<string, string>();
  const registerArea = (name: string, id: string) => {
    areaCache.set(name, id);
    const key = distributionAreaLookupKey(name);
    if (key && !areaCache.has(key)) areaCache.set(key, id);
    const sanitized = sanitizeDistributionAreaName(name);
    if (sanitized && sanitized !== name && !areaCache.has(sanitized)) {
      areaCache.set(sanitized, id);
    }
  };
  for (const a of existingAreas) registerArea(a.name, a.id);
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

  function resolveAreaId(areaName: string): string | undefined {
    const exact = areaCache.get(areaName);
    if (exact) return exact;
    const key = distributionAreaLookupKey(areaName);
    if (key) {
      const byKey = areaCache.get(key);
      if (byKey) return byKey;
    }
    const sanitized = sanitizeDistributionAreaName(areaName);
    if (sanitized) return areaCache.get(sanitized);
    return undefined;
  }

  const areasToCreate: string[] = [];
  const seenNewArea = new Set<string>();
  for (const row of validRows) {
    if (!row.areaName) continue;
    const key = distributionAreaLookupKey(row.areaName);
    if (!key || !isValidDistributionAreaName(row.areaName)) continue;
    if (resolveAreaId(row.areaName) || seenNewArea.has(key)) continue;
    seenNewArea.add(key);
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
    for (const a of created) registerArea(a.name, a.id);
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
      distributionAreaId: row.areaName ? resolveAreaId(row.areaName) ?? null : null,
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
    const areaId = resolveAreaId(row.areaName);
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
      pushLocationAliasImportFailure(result, row, "LOCATION_NOT_CREATED");
      continue;
    }
    const key = aliasLookupKey(row.originalName);
    if (!key) {
      pushLocationAliasImportFailure(result, row, "INVALID_SOURCE_NAME");
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
              normalizedOriginalName: d.key,
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

  try {
    await renormalizeDeliveryLocationAliases();
  } catch (e) {
    console.error("[locations] renormalize after import failed", e);
  }

  try {
    await reMatchUnmatchedShipments();
  } catch (e) {
    console.error("[locations] reMatch after import failed", e);
  }

  // לאחר ייבוא התאמות — רענון אזורי חלוקה למשלוחים קיימים
  try {
    await backfillShipmentDistributionZones({ onlyMissingZone: true });
  } catch (e) {
    console.error("[locations] backfill after alias import failed", e);
  }

  await persistLocationAliasImportAudit(result);
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
