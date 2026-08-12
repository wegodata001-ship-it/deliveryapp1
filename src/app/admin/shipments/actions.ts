"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  requireShipmentCountryScope,
  shipmentCountrySlugFromWorkCountry,
} from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import {
  listShipmentBatches,
  listShipmentRecords,
  listShipmentRecordsByBatchIds,
  listAllShipmentRecords,
  createShipmentBatch,
  importRowsIntoBatch,
  updateShipmentBatch,
  getShipmentBatch,
  assignZone,
  assignCourier,
  updateShipmentStatus,
  updateShipmentRecord,
  listZones,
  createZone,
  updateZone,
  setZoneActive,
  deleteZone,
  listCouriers,
  createCourier,
  updateCourier,
  setCourierActive,
  deleteCourier,
  addShipmentPayment,
  saveShipmentPayments,
  deleteShipmentPaymentLine,
  getShipmentRecordById,
  deleteShipmentRecord,
  deleteShipmentBatches,
  createShipmentRecord,
  createShipmentRecordsBulk,
  previewCourierDebtClose,
  closeCourierDebts,
} from "@/app/admin/shipments/service";
import type {
  ShipmentBatchDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentCourierDto,
  CreateBatchInput,
  ImportRowsIntoBatchInput,
  AssignZoneInput,
  AssignCourierInput,
  UpdateStatusInput,
  AddPaymentInput,
  SaveShipmentPaymentsInput,
  UpdateShipmentRecordInput,
  CreateShipmentRecordInput,
  UpdateShipmentBatchInput,
} from "@/app/admin/shipments/types";
import { PAYMENT_METHODS } from "@/app/admin/shipments/types";
import type { ShipmentPaymentMethodOption } from "@/lib/shipment-payment-method-filter";
import {
  commitBatchDeliveryFeeImport,
  previewBatchDeliveryFeeImport,
} from "@/app/admin/shipments/delivery-fee-import-service";
import type {
  DeliveryFeeImportPreview,
  DeliveryFeeImportResult,
} from "@/lib/shipment-delivery-fee-import";

const VIEW_PERMS = ["manage_shipments", "view_shipments"];
const WRITE_PERMS = ["manage_shipments"];

function revalidate(workCountry: WorkCountryCode) {
  const slug = shipmentCountrySlugFromWorkCountry(workCountry);
  revalidatePath(`/admin/shipments/${slug}`);
  revalidatePath(`/admin/shipments/${slug}/control`);
}

function countryPath(workCountry: WorkCountryCode, suffix = ""): string {
  const base = `/admin/shipments/${shipmentCountrySlugFromWorkCountry(workCountry)}`;
  return suffix ? `${base}/${suffix}` : base;
}

// ─── Batches ─────────────────────────────────────────────────────────────────

export async function listShipmentBatchesAction(
  workCountry: WorkCountryCode,
): Promise<
  { ok: true; batches: ShipmentBatchDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const batches = await listShipmentBatches(workCountry);
    return { ok: true, batches };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createShipmentBatchAction(
  workCountry: WorkCountryCode,
  input: CreateBatchInput
): Promise<
  | { ok: true; batchId: string; matchSummary: import("@/app/admin/shipments/types").ShipmentImportMatchSummary }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await createShipmentBatch(input, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, batchId: result.batchId, matchSummary: result.matchSummary };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function importRowsIntoBatchAction(
  workCountry: WorkCountryCode,
  input: ImportRowsIntoBatchInput
): Promise<
  | { ok: true; count: number; matchSummary: import("@/app/admin/shipments/types").ShipmentImportMatchSummary }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await importRowsIntoBatch(input, workCountry);
    revalidate(workCountry);
    revalidatePath(countryPath(workCountry, input.batchId));
    return { ok: true, count: result.count, matchSummary: result.matchSummary };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function previewShipmentImportLocationMappingsAction(
  workCountry: WorkCountryCode,
  originalPlaces: string[],
): Promise<
  | { ok: true; mappings: import("@/app/admin/shipments/types").ShipmentImportLocationMappingDto[] }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const { previewImportLocationMappings } = await import(
      "@/lib/shipment-import-location-mapping"
    );
    const mappings = await previewImportLocationMappings(originalPlaces);
    return { ok: true, mappings };
  } catch (e) {
    console.error("[shipments] previewShipmentImportLocationMappings failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateShipmentBatchAction(
  workCountry: WorkCountryCode,
  input: UpdateShipmentBatchInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await updateShipmentBatch(input, workCountry);
    revalidate(workCountry);
    revalidatePath(countryPath(workCountry, input.batchId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getShipmentBatchAction(
  workCountry: WorkCountryCode,
  batchId: string
): Promise<{ ok: true; batch: ShipmentBatchDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const batch = await getShipmentBatch(batchId, workCountry);
    if (!batch) return { ok: false, error: "משלוח לא נמצא" };
    return { ok: true, batch };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listShipmentRecordsByBatchIdsAction(
  workCountry: WorkCountryCode,
  batchIds: string[]
): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const records = await listShipmentRecordsByBatchIds(batchIds, workCountry);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function listShipmentRecordsAction(
  workCountry: WorkCountryCode,
  batchId: string
): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const records = await listShipmentRecords(batchId, workCountry);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listAllRecordsAction(
  workCountry: WorkCountryCode,
  filter?: {
  zoneId?: string;
  courierName?: string;
  status?: string;
  paymentStatus?: string;
}): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const records = await listAllShipmentRecords(workCountry, filter);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getShipmentRecordAction(
  workCountry: WorkCountryCode,
  recordId: string
): Promise<{ ok: true; record: ShipmentRecordDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const record = await getShipmentRecordById(recordId, workCountry);
    if (!record) return { ok: false, error: "משלוח לא נמצא" };
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteShipmentRecordAction(
  workCountry: WorkCountryCode,
  recordId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deleteShipmentRecord(recordId, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteShipmentBatchesAction(
  workCountry: WorkCountryCode,
  batchIds: string[]
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const deleted = await deleteShipmentBatches(batchIds, workCountry);
    revalidate(workCountry);
    return { ok: true, deleted };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignZoneAction(
  workCountry: WorkCountryCode,
  input: AssignZoneInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await assignZone(input, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignCourierAction(
  workCountry: WorkCountryCode,
  input: AssignCourierInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await assignCourier(input, workCountry, me.id);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateShipmentStatusAction(
  workCountry: WorkCountryCode,
  input: UpdateStatusInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await updateShipmentStatus(input, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function previewCourierDebtCloseAction(
  workCountry: WorkCountryCode,
  input: {
  courierId: string;
  zoneIds: string[];
  batchIds?: string[];
}): Promise<
  | { ok: true; preview: Awaited<ReturnType<typeof previewCourierDebtClose>> }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const preview = await previewCourierDebtClose({ ...input, workCountry });
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function closeCourierDebtsAction(
  workCountry: WorkCountryCode,
  input: {
  courierId: string;
  zoneIds: string[];
  batchIds?: string[];
  paymentMethod: string;
}): Promise<
  | {
      ok: true;
      closedCount: number;
      skippedCount: number;
      courierName: string;
      zoneNames: string[];
      eligibleFeeIls: number;
      skipped: Awaited<ReturnType<typeof closeCourierDebts>>["preview"]["skipped"];
    }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await closeCourierDebts({ ...input, userId: me.id, workCountry });
    revalidate(workCountry);
    return {
      ok: true,
      closedCount: result.closedCount,
      skippedCount: result.preview.skipped.length,
      courierName: result.preview.courierName,
      zoneNames: result.preview.zoneNames,
      eligibleFeeIls: result.preview.summary.eligibleFeeIls,
      skipped: result.preview.skipped,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateShipmentRecordAction(
  workCountry: WorkCountryCode,
  input: UpdateShipmentRecordInput
): Promise<{ ok: true; updatedRecordIds: string[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const result = await updateShipmentRecord(input, workCountry);
    revalidate(workCountry);
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createShipmentRecordAction(
  workCountry: WorkCountryCode,
  input: CreateShipmentRecordInput,
): Promise<{ ok: true; record: ShipmentRecordDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const record = await createShipmentRecord(input, workCountry);
    revalidate(workCountry);
    revalidatePath(countryPath(workCountry, input.batchId));
    return { ok: true, record };
  } catch (e) {
    console.error("[shipments] createShipmentRecord failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createShipmentRecordsBulkAction(
  workCountry: WorkCountryCode,
  input: {
  batchId: string;
  count: number;
}): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const records = await createShipmentRecordsBulk(input.batchId, input.count, workCountry);
    revalidate(workCountry);
    revalidatePath(countryPath(workCountry, input.batchId));
    return { ok: true, records };
  } catch (e) {
    console.error("[shipments] createShipmentRecordsBulk failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function listZonesAction(
  workCountry: WorkCountryCode,
): Promise<
  { ok: true; zones: ShipmentZoneDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const zones = await listZones(workCountry);
    return { ok: true, zones };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createZoneAction(
  workCountry: WorkCountryCode,
  name: string
): Promise<{ ok: true; zone: ShipmentZoneDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const zone = await createZone(name, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, zone };
  } catch (e) {
    console.error("[shipments] createZone failed", { name, error: e });
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export async function updateZoneAction(
  workCountry: WorkCountryCode,
  id: string,
  nameOrPatch: string | { name?: string; code?: string | null; sortOrder?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const patch =
      typeof nameOrPatch === "string" ? { name: nameOrPatch } : nameOrPatch;
    await updateZone(id, patch, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setZoneActiveAction(
  workCountry: WorkCountryCode,
  id: string,
  isActive: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await setZoneActive(id, isActive, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteZoneAction(
  workCountry: WorkCountryCode,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deleteZone(id, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Couriers ────────────────────────────────────────────────────────────────

export async function listCouriersAction(
  workCountry: WorkCountryCode,
): Promise<
  { ok: true; couriers: ShipmentCourierDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    return { ok: true, couriers: await listCouriers(workCountry) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** אמצעי תשלום לסינון גבייה — SSOT מ־payment_methods (+ שיטות משלוחים נפוצות) */
export async function listShipmentPaymentMethodsAction(): Promise<
  { ok: true; methods: ShipmentPaymentMethodOption[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };

    const { readPaymentMethodTagsFromDb } = await import(
      "@/lib/payment-method-registry-data"
    );
    const tags = await readPaymentMethodTagsFromDb(false);
    const byId = new Map<string, ShipmentPaymentMethodOption>();
    for (const t of tags) {
      byId.set(t.id, { id: t.id, label: t.nameHe });
    }
    // ודא ששיטות המשלוחים הסטנדרטיות מופיעות גם אם חסרות בטבלה
    for (const m of PAYMENT_METHODS) {
      if (!byId.has(m.value)) byId.set(m.value, { id: m.value, label: m.label });
    }
    const preferred = [
      "CASH",
      "BANK_TRANSFER",
      "CREDIT",
      "CHECK",
      "BIT",
      "PAYBOX",
      "OTHER",
    ];
    const methods: ShipmentPaymentMethodOption[] = [];
    for (const id of preferred) {
      const hit = byId.get(id);
      if (hit) {
        methods.push(hit);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) methods.push(rest);
    return { ok: true, methods };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createCourierAction(
  workCountry: WorkCountryCode,
  name: string
): Promise<{ ok: true; courier: ShipmentCourierDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const courier = await createCourier(name, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, courier };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateCourierAction(
  workCountry: WorkCountryCode,
  id: string,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await updateCourier(id, name, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setCourierActiveAction(
  workCountry: WorkCountryCode,
  id: string,
  isActive: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await setCourierActive(id, isActive, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteCourierAction(
  workCountry: WorkCountryCode,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deleteCourier(id, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function addShipmentPaymentAction(
  workCountry: WorkCountryCode,
  input: AddPaymentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await addShipmentPayment(input, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveShipmentPaymentsAction(
  workCountry: WorkCountryCode,
  input: SaveShipmentPaymentsInput
): Promise<{ ok: true; record: ShipmentRecordDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const record = await saveShipmentPayments(input, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deletePaymentLineAction(
  workCountry: WorkCountryCode,
  lineId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    await deleteShipmentPaymentLine(lineId, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Delivery fee pricing import ─────────────────────────────────────────────

export async function previewDeliveryFeeImportAction(
  workCountry: WorkCountryCode,
  batchId: string,
  grid: unknown[][],
): Promise<{ ok: true; preview: DeliveryFeeImportPreview } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    return await previewBatchDeliveryFeeImport(batchId.trim(), grid, workCountry);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function commitDeliveryFeeImportAction(
  workCountry: WorkCountryCode,
  batchId: string,
  preview: DeliveryFeeImportPreview,
): Promise<{ ok: true; result: DeliveryFeeImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const res = await commitBatchDeliveryFeeImport({
      batchId: batchId.trim(),
      userId: me.id,
      preview,
      workCountry,
    });
    if (res.ok) revalidate(workCountry);
    return res;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
