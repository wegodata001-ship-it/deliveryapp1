"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  listManualShipments,
  createManualShipment,
  updateManualShipment,
  softDeleteManualShipment,
  softDeleteManualShipments,
  duplicateManualShipment,
  getManualShipment,
} from "@/app/admin/shipments/manual/service";
import type {
  ManualShipmentDto,
  ManualShipmentFilters,
  ManualShipmentInput,
} from "@/app/admin/shipments/manual/types";

const VIEW_PERMS = ["manage_shipments", "view_shipments"];
const WRITE_PERMS = ["manage_shipments"];

function revalidate() {
  revalidatePath("/admin/shipments/manual");
}

export async function listManualShipmentsAction(
  filters: ManualShipmentFilters = {}
): Promise<{ ok: true; rows: ManualShipmentDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    const rows = await listManualShipments(filters);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createManualShipmentAction(
  input: ManualShipmentInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    const id = await createManualShipment(input, me.id);
    revalidate();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateManualShipmentAction(
  id: string,
  input: ManualShipmentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    await updateManualShipment(id, input);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteManualShipmentAction(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    await softDeleteManualShipment(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteManualShipmentsAction(
  ids: string[]
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    const count = await softDeleteManualShipments(ids);
    revalidate();
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function duplicateManualShipmentAction(
  id: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    const newId = await duplicateManualShipment(id, me.id);
    if (!newId) return { ok: false, error: "הרשומה לא נמצאה" };
    revalidate();
    return { ok: true, id: newId };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getManualShipmentAction(
  id: string
): Promise<{ ok: true; row: ManualShipmentDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    const row = await getManualShipment(id);
    if (!row) return { ok: false, error: "הרשומה לא נמצאה" };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
