"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  listShipmentBatches,
  listShipmentRecords,
  listAllShipmentRecords,
  createShipmentBatch,
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
} from "@/app/admin/shipments/service";
import type {
  ShipmentBatchDto,
  ShipmentRecordDto,
  ShipmentZoneDto,
  ShipmentCourierDto,
  CreateBatchInput,
  AssignZoneInput,
  AssignCourierInput,
  UpdateStatusInput,
  AddPaymentInput,
  SaveShipmentPaymentsInput,
  UpdateShipmentRecordInput,
} from "@/app/admin/shipments/types";

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
): Promise<{ ok: true; batchId: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const batchId = await createShipmentBatch(input, me.id);
    revalidate();
    return { ok: true, batchId };
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
    await assignCourier(input);
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

export async function updateShipmentRecordAction(
  input: UpdateShipmentRecordInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateShipmentRecord(input);
    revalidate();
    return { ok: true };
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
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await updateZone(id, name);
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
