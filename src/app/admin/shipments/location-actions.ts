"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  requireShipmentCountryScope,
  shipmentCountrySlugFromWorkCountry,
} from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import {
  listDeliveryLocations,
  createDeliveryLocation,
  updateDeliveryLocation,
  bulkAssignLocationsToArea,
  deactivateLocationAlias,
  updateAliasMapping,
  createAliasMapping,
  purgeAllDistributionZones,
  cleanupMisimportedAreasAndLocations,
  listAliasMappingRows,
  previewLocationAliasImport,
  commitLocationAliasImportRows,
  formatLocationAliasImportCommitError,
  validateLocationAliasImportCommitRows,
  backfillShipmentDistributionZones,
  fixShipmentLocation,
  type LocationAliasImportRow,
  type AliasMappingRow,
  assignZoneWithOptionalLocationUpdate,
  reorderZones,
  addLocationAlias,
  updateLocationAliasOriginalName,
  renormalizeDeliveryLocationAliases,
  reMatchUnmatchedShipments,
  type DeliveryLocationDto,
  type LocationAliasImportPreview,
  type LocationAliasImportResult,
} from "@/app/admin/shipments/location-service";
import { listZones, createZone, updateZone, setZoneActive, deleteZone } from "@/app/admin/shipments/service";
import type { ShipmentZoneDto } from "@/app/admin/shipments/types";

const VIEW_PERMS = ["manage_shipments", "view_shipments"];
const WRITE_PERMS = ["manage_shipments"];

function revalidateLocations(workCountry: WorkCountryCode) {
  const slug = shipmentCountrySlugFromWorkCountry(workCountry);
  revalidatePath(`/admin/shipments/${slug}`);
  revalidatePath(`/admin/shipments/${slug}/locations`);
  revalidatePath(`/admin/shipments/${slug}/control`);
}

export async function listDeliveryLocationsAction(
  workCountry: WorkCountryCode,
  opts?: {
    search?: string;
    areaId?: string;
    includeInactive?: boolean;
  },
): Promise<{ ok: true; locations: DeliveryLocationDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const locations = await listDeliveryLocations(workCountry, opts);
    return { ok: true, locations };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createDeliveryLocationAction(
  workCountry: WorkCountryCode,
  input: {
    displayName: string;
    distributionAreaId?: string | null;
  },
): Promise<{ ok: true; location: DeliveryLocationDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const location = await createDeliveryLocation(workCountry, input);
    revalidateLocations(workCountry);
    return { ok: true, location };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateDeliveryLocationAction(
  workCountry: WorkCountryCode,
  input: {
    id: string;
    displayName?: string;
    distributionAreaId?: string | null;
    isActive?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await updateDeliveryLocation(input);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function bulkAssignLocationsToAreaAction(
  workCountry: WorkCountryCode,
  input: {
    locationIds: string[];
    distributionAreaId: string | null;
  },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const count = await bulkAssignLocationsToArea(input);
    revalidateLocations(workCountry);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteLocationAliasAction(
  workCountry: WorkCountryCode,
  aliasId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deactivateLocationAlias(aliasId);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateAliasMappingAction(
  workCountry: WorkCountryCode,
  input: {
    aliasId: string;
    displayName: string;
    deliveryLocationId?: string | null;
    distributionAreaId?: string | null;
  },
): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const row = await updateAliasMapping({ ...input, workCountry });
    revalidateLocations(workCountry);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createAliasMappingAction(
  workCountry: WorkCountryCode,
  input: {
    originalName: string;
    displayName: string;
    distributionAreaId?: string | null;
  },
): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const row = await createAliasMapping({ ...input, workCountry });
    revalidateLocations(workCountry);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function purgeAllDistributionZonesAction(
  workCountry: WorkCountryCode,
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const deleted = await purgeAllDistributionZones();
    revalidateLocations(workCountry);
    return { ok: true, deleted };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function cleanupMisimportedAreasAction(
  workCountry: WorkCountryCode,
): Promise<
  | {
      ok: true;
      deletedFakeZones: number;
      deletedZoneNamedLocations: number;
      keptRealZones: number;
      keptLocalities: number;
    }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await cleanupMisimportedAreasAndLocations(workCountry);
    revalidateLocations(workCountry);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listAliasMappingRowsAction(
  workCountry: WorkCountryCode,
  opts?: {
    search?: string;
    includeInactive?: boolean;
  },
): Promise<{ ok: true; rows: AliasMappingRow[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const rows = await listAliasMappingRows(workCountry, opts);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function previewLocationAliasImportAction(
  workCountry: WorkCountryCode,
  grid: unknown[][],
): Promise<{ ok: true; preview: LocationAliasImportPreview } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const preview = await previewLocationAliasImport(grid);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function commitLocationAliasImportAction(
  workCountry: WorkCountryCode,
  grid: unknown[][],
): Promise<{ ok: true; result: LocationAliasImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const preview = await previewLocationAliasImport(grid);
    if (preview.mappingError) {
      return { ok: false, error: preview.mappingError };
    }
    const validRows = preview.rows.filter((r) => r.valid);
    if (validRows.length === 0) {
      return { ok: false, error: "אין שורות תקינות לייבוא" };
    }
    return commitLocationAliasRowsAction(workCountry, validRows, preview.totalRows);
  } catch (e) {
    console.error("[locations] commitLocationAliasImportAction failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `ייבוא נכשל: ${message}` };
  }
}

export async function commitLocationAliasRowsAction(
  workCountry: WorkCountryCode,
  rows: LocationAliasImportRow[],
  totalRows: number,
  options?: { fileName?: string | null },
): Promise<{ ok: true; result: LocationAliasImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "אין שורות לייבוא" };
    }
    if (rows.length > 20_000) {
      return { ok: false, error: "יותר מדי שורות לייבוא אחד — פצלו את הקובץ" };
    }

    const commitValidation = validateLocationAliasImportCommitRows(rows);
    if (!commitValidation.ok) {
      const message = formatLocationAliasImportCommitError(commitValidation);
      console.error("[locations] import commit validation failed", commitValidation);
      return { ok: false, error: message };
    }

    const result = await commitLocationAliasImportRows(workCountry, rows, me.id, totalRows, options);
    if (result.failed > 0 && result.errors.length > 0) {
      console.error("[locations] import partial failures", result.errors);
    }
    revalidateLocations(workCountry);
    return { ok: true, result };
  } catch (e) {
    console.error("[locations] commitLocationAliasImport failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `ייבוא נכשל: ${message}` };
  }
}

export async function backfillShipmentZonesAction(
  workCountry: WorkCountryCode,
  input?: { batchId?: string },
): Promise<
  | {
      ok: true;
      result: {
        scanned: number;
        matched: number;
        updated: number;
        unmatched: number;
        skipped: number;
      };
    }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await backfillShipmentDistributionZones({
      batchId: input?.batchId,
      onlyMissingZone: true,
    });
    revalidateLocations(workCountry);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function fixShipmentLocationAction(
  workCountry: WorkCountryCode,
  input: {
    recordId: string;
    deliveryLocationId?: string | null;
    newDisplayName?: string | null;
    distributionAreaId?: string | null;
    saveAsPermanentAlias?: boolean;
  },
): Promise<{ ok: true; updatedRecordIds: string[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await fixShipmentLocation({ ...input, workCountry, changedById: me.id });
    revalidateLocations(workCountry);
    revalidatePath(`/admin/shipments/${shipmentCountrySlugFromWorkCountry(workCountry)}`);
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignZoneWithLocationPromptAction(
  workCountry: WorkCountryCode,
  input: {
    recordIds: string[];
    zoneId: string | null;
    updateLocationPermanently?: boolean;
  },
): Promise<{ ok: true; updatedRecordIds: string[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await assignZoneWithOptionalLocationUpdate({
      ...input,
      changedById: me.id,
    });
    revalidateLocations(workCountry);
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listZonesForLocationsAction(
  workCountry: WorkCountryCode,
): Promise<{ ok: true; zones: ShipmentZoneDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    return { ok: true, zones: await listZones(workCountry) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createZoneForLocationsAction(
  workCountry: WorkCountryCode,
  name: string,
): Promise<{ ok: true; zone: ShipmentZoneDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const zone = await createZone(name, me.id, workCountry);
    revalidateLocations(workCountry);
    return { ok: true, zone };
  } catch (e) {
    console.error("[locations] createZone failed", { name, error: e });
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function updateZoneForLocationsAction(
  workCountry: WorkCountryCode,
  id: string,
  patch: { name?: string; code?: string | null; sortOrder?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await updateZone(id, patch, workCountry);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setZoneActiveForLocationsAction(
  workCountry: WorkCountryCode,
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await setZoneActive(id, isActive, workCountry);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteZoneForLocationsAction(
  workCountry: WorkCountryCode,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deleteZone(id, workCountry);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reorderZonesAction(
  workCountry: WorkCountryCode,
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await reorderZones(orderedIds);
    revalidateLocations(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function addLocationAliasAction(
  workCountry: WorkCountryCode,
  input: {
    deliveryLocationId: string;
    originalName: string;
  },
): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const row = await addLocationAlias({ ...input, createdBy: me.id });
    revalidateLocations(workCountry);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateLocationAliasOriginalNameAction(
  workCountry: WorkCountryCode,
  input: {
    aliasId: string;
    originalName: string;
  },
): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const row = await updateLocationAliasOriginalName(input);
    revalidateLocations(workCountry);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reMatchUnmatchedShipmentsAction(
  workCountry: WorkCountryCode,
  input?: { batchId?: string },
): Promise<
  | { ok: true; result: { scanned: number; matched: number; updated: number } }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await renormalizeDeliveryLocationAliases(workCountry);
    const result = await reMatchUnmatchedShipments({ batchId: input?.batchId });
    revalidateLocations(workCountry);
    revalidatePath(`/admin/shipments/${shipmentCountrySlugFromWorkCountry(workCountry)}`);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
