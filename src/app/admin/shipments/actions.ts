"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
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

function revalidate() {
  revalidatePath("/admin/shipments");
  revalidatePath("/admin/shipments/control");
}

// ─── Batches ─────────────────────────────────────────────────────────────────

export async function listShipmentBatchesAction(): Promise<
  { ok: true; batches: ShipmentBatchDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const batches = await listShipmentBatches();
    return { ok: true, batches };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createShipmentBatchAction(
  input: CreateBatchInput
): Promise<
  | { ok: true; batchId: string; matchSummary: import("@/app/admin/shipments/types").ShipmentImportMatchSummary }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const result = await createShipmentBatch(input, me.id);
    revalidate();
    return { ok: true, batchId: result.batchId, matchSummary: result.matchSummary };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function importRowsIntoBatchAction(
  input: ImportRowsIntoBatchInput
): Promise<
  | { ok: true; count: number; matchSummary: import("@/app/admin/shipments/types").ShipmentImportMatchSummary }
  | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const result = await importRowsIntoBatch(input);
    revalidate();
    revalidatePath(`/admin/shipments/${input.batchId}`);
    return { ok: true, count: result.count, matchSummary: result.matchSummary };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateShipmentBatchAction(
  input: UpdateShipmentBatchInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateShipmentBatch(input);
    revalidate();
    revalidatePath(`/admin/shipments/${input.batchId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getShipmentBatchAction(
  batchId: string
): Promise<{ ok: true; batch: ShipmentBatchDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const batch = await getShipmentBatch(batchId);
    if (!batch) return { ok: false, error: "משלוח לא נמצא" };
    return { ok: true, batch };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listShipmentRecordsByBatchIdsAction(
  batchIds: string[]
): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const records = await listShipmentRecordsByBatchIds(batchIds);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function listShipmentRecordsAction(
  batchId: string
): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const records = await listShipmentRecords(batchId);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function listAllRecordsAction(filter?: {
  zoneId?: string;
  courierName?: string;
  status?: string;
  paymentStatus?: string;
}): Promise<{ ok: true; records: ShipmentRecordDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const records = await listAllShipmentRecords(filter);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getShipmentRecordAction(
  recordId: string
): Promise<{ ok: true; record: ShipmentRecordDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const record = await getShipmentRecordById(recordId);
    if (!record) return { ok: false, error: "משלוח לא נמצא" };
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteShipmentRecordAction(
  recordId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteShipmentRecord(recordId);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteShipmentBatchesAction(
  batchIds: string[]
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const deleted = await deleteShipmentBatches(batchIds);
    revalidate();
    return { ok: true, deleted };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignZoneAction(
  input: AssignZoneInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await assignZone(input);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function assignCourierAction(
  input: AssignCourierInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await assignCourier(input, me.id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateShipmentStatusAction(
  input: UpdateStatusInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateShipmentStatus(input);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function previewCourierDebtCloseAction(input: {
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
    const preview = await previewCourierDebtClose(input);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function closeCourierDebtsAction(input: {
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
    const result = await closeCourierDebts({ ...input, userId: me.id });
    revalidate();
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
  input: UpdateShipmentRecordInput
): Promise<{ ok: true; updatedRecordIds: string[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const result = await updateShipmentRecord(input);
    revalidate();
    return { ok: true, updatedRecordIds: result.updatedRecordIds };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function listZonesAction(): Promise<
  { ok: true; zones: ShipmentZoneDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const zones = await listZones();
    return { ok: true, zones };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createZoneAction(
  name: string
): Promise<{ ok: true; zone: ShipmentZoneDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const zone = await createZone(name, me.id);
    revalidate();
    return { ok: true, zone };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateZoneAction(
  id: string,
  nameOrPatch: string | { name?: string; code?: string | null; sortOrder?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const patch =
      typeof nameOrPatch === "string" ? { name: nameOrPatch } : nameOrPatch;
    await updateZone(id, patch);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setZoneActiveAction(
  id: string,
  isActive: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await setZoneActive(id, isActive);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteZoneAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteZone(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Couriers ────────────────────────────────────────────────────────────────

export async function listCouriersAction(): Promise<
  { ok: true; couriers: ShipmentCourierDto[] } | { ok: false; error: string }
> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    return { ok: true, couriers: await listCouriers() };
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
  name: string
): Promise<{ ok: true; courier: ShipmentCourierDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const courier = await createCourier(name, me.id);
    revalidate();
    return { ok: true, courier };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateCourierAction(
  id: string,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateCourier(id, name);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function setCourierActiveAction(
  id: string,
  isActive: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await setCourierActive(id, isActive);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteCourierAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteCourier(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function addShipmentPaymentAction(
  input: AddPaymentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await addShipmentPayment(input, me.id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveShipmentPaymentsAction(
  input: SaveShipmentPaymentsInput
): Promise<{ ok: true; record: ShipmentRecordDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const record = await saveShipmentPayments(input, me.id);
    revalidate();
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deletePaymentLineAction(
  lineId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteShipmentPaymentLine(lineId);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Delivery fee pricing import ─────────────────────────────────────────────

export async function previewDeliveryFeeImportAction(
  batchId: string,
  grid: unknown[][],
): Promise<{ ok: true; preview: DeliveryFeeImportPreview } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    return await previewBatchDeliveryFeeImport(batchId.trim(), grid);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function commitDeliveryFeeImportAction(
  batchId: string,
  preview: DeliveryFeeImportPreview,
): Promise<{ ok: true; result: DeliveryFeeImportResult } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const res = await commitBatchDeliveryFeeImport({
      batchId: batchId.trim(),
      userId: me.id,
      preview,
    });
    if (res.ok) revalidate();
    return res;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
