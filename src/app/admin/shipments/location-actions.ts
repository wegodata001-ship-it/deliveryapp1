"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
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
  commitLocationAliasImport,
  commitLocationAliasImportRows,
  formatLocationAliasImportCommitError,
  formatLocationAliasImportResultErrors,
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

function revalidateLocations() {
  revalidatePath("/admin/shipments");
  revalidatePath("/admin/shipments/locations");
  revalidatePath("/admin/shipments/control");
}

export async function listDeliveryLocationsAction(opts?: {
  search?: string;
  areaId?: string;
  includeInactive?: boolean;
}): Promise<{ ok: true; locations: DeliveryLocationDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const locations = await listDeliveryLocations(opts);
    return { ok: true, locations };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createDeliveryLocationAction(input: {
  displayName: string;
  distributionAreaId?: string | null;
}): Promise<{ ok: true; location: DeliveryLocationDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const location = await createDeliveryLocation(input);
    revalidateLocations();
    return { ok: true, location };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateDeliveryLocationAction(input: {
  id: string;
  displayName?: string;
  distributionAreaId?: string | null;
  isActive?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateDeliveryLocation(input);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function bulkAssignLocationsToAreaAction(input: {
  locationIds: string[];
  distributionAreaId: string | null;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const count = await bulkAssignLocationsToArea(input);
    revalidateLocations();
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteLocationAliasAction(
  aliasId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deactivateLocationAlias(aliasId);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateAliasMappingAction(input: {
  aliasId: string;
  displayName: string;
  deliveryLocationId?: string | null;
  distributionAreaId?: string | null;
}): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const row = await updateAliasMapping(input);
    revalidateLocations();
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createAliasMappingAction(input: {
  originalName: string;
  displayName: string;
  distributionAreaId?: string | null;
}): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const row = await createAliasMapping(input);
    revalidateLocations();
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function purgeAllDistributionZonesAction(): Promise<
  { ok: true; deleted: number } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const deleted = await purgeAllDistributionZones();
    revalidateLocations();
    return { ok: true, deleted };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function cleanupMisimportedAreasAction(): Promise<
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
    const result = await cleanupMisimportedAreasAndLocations();
    revalidateLocations();
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listAliasMappingRowsAction(opts?: {
  search?: string;
  includeInactive?: boolean;
}): Promise<{ ok: true; rows: AliasMappingRow[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const rows = await listAliasMappingRows(opts);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function previewLocationAliasImportAction(
  grid: unknown[][],
): Promise<{ ok: true; preview: LocationAliasImportPreview } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const preview = await previewLocationAliasImport(grid);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function commitLocationAliasImportAction(
  grid: unknown[][],
): Promise<{ ok: true; result: LocationAliasImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const preview = await previewLocationAliasImport(grid);
    if (preview.mappingError) {
      return { ok: false, error: preview.mappingError };
    }
    const validRows = preview.rows.filter((r) => r.valid);
    if (validRows.length === 0) {
      return { ok: false, error: "אין שורות תקינות לייבוא" };
    }
    return commitLocationAliasRowsAction(validRows, preview.totalRows);
  } catch (e) {
    console.error("[locations] commitLocationAliasImportAction failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `ייבוא נכשל: ${message}` };
  }
}

/** ייבוא קל משקל — שולחים רק שורות תקינות (לא את כל ה־grid) */
export async function commitLocationAliasRowsAction(
  rows: LocationAliasImportRow[],
  totalRows: number,
  options?: { fileName?: string | null },
): Promise<{ ok: true; result: LocationAliasImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
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

    const result = await commitLocationAliasImportRows(rows, me.id, totalRows, options);
    if (result.failed > 0 && result.errors.length > 0) {
      console.error("[locations] import partial failures", result.errors);
    }
    revalidateLocations();
    return { ok: true, result };
  } catch (e) {
    console.error("[locations] commitLocationAliasImport failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `ייבוא נכשל: ${message}` };
  }
}

export async function backfillShipmentZonesAction(input?: {
  batchId?: string;
}): Promise<
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
    const result = await backfillShipmentDistributionZones({
      batchId: input?.batchId,
      onlyMissingZone: true,
    });
    revalidateLocations();
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function fixShipmentLocationAction(input: {
  recordId: string;
  deliveryLocationId?: string | null;
  newDisplayName?: string | null;
  distributionAreaId?: string | null;
  saveAsPermanentAlias?: boolean;
}): Promise<{ ok: true; updatedRecordIds: string[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const result = await fixShipmentLocation({ ...input, changedById: me.id });
    revalidateLocations();
    revalidatePath("/admin/shipments");
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignZoneWithLocationPromptAction(input: {
  recordIds: string[];
  zoneId: string | null;
  updateLocationPermanently?: boolean;
}): Promise<
  { ok: true; updatedRecordIds: string[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const result = await assignZoneWithOptionalLocationUpdate({
      ...input,
      changedById: me.id,
    });
    revalidateLocations();
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listZonesForLocationsAction(): Promise<
  { ok: true; zones: ShipmentZoneDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    return { ok: true, zones: await listZones() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createZoneForLocationsAction(
  name: string,
): Promise<{ ok: true; zone: ShipmentZoneDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const zone = await createZone(name, me.id);
    revalidateLocations();
    return { ok: true, zone };
  } catch (e) {
    console.error("[locations] createZone failed", { name, error: e });
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function updateZoneForLocationsAction(
  id: string,
  patch: { name?: string; code?: string | null; sortOrder?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateZone(id, patch);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setZoneActiveForLocationsAction(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await setZoneActive(id, isActive);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteZoneForLocationsAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteZone(id);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reorderZonesAction(
  orderedIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await reorderZones(orderedIds);
    revalidateLocations();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function addLocationAliasAction(input: {
  deliveryLocationId: string;
  originalName: string;
}): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const row = await addLocationAlias({ ...input, createdBy: me.id });
    revalidateLocations();
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateLocationAliasOriginalNameAction(input: {
  aliasId: string;
  originalName: string;
}): Promise<{ ok: true; row: AliasMappingRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const row = await updateLocationAliasOriginalName(input);
    revalidateLocations();
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reMatchUnmatchedShipmentsAction(input?: {
  batchId?: string;
}): Promise<
  | { ok: true; result: { scanned: number; matched: number; updated: number } }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await renormalizeDeliveryLocationAliases();
    const result = await reMatchUnmatchedShipments({ batchId: input?.batchId });
    revalidateLocations();
    revalidatePath("/admin/shipments");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
