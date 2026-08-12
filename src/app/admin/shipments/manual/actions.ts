"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  requireShipmentCountryScope,
  shipmentCountrySlugFromWorkCountry,
} from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
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

function revalidate(workCountry: WorkCountryCode) {
  const slug = shipmentCountrySlugFromWorkCountry(workCountry);
  revalidatePath(`/admin/shipments/${slug}/manual`);
}

export async function listManualShipmentsAction(
  workCountry: WorkCountryCode,
  filters: ManualShipmentFilters = {}
): Promise<{ ok: true; rows: ManualShipmentDto[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    const rows = await listManualShipments(workCountry, filters);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function createManualShipmentAction(
  workCountry: WorkCountryCode,
  input: ManualShipmentInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    const id = await createManualShipment(workCountry, input, me.id);
    revalidate(workCountry);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function updateManualShipmentAction(
  workCountry: WorkCountryCode,
  id: string,
  input: ManualShipmentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    await updateManualShipment(id, workCountry, input);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteManualShipmentAction(
  workCountry: WorkCountryCode,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    await softDeleteManualShipment(id, workCountry);
    revalidate(workCountry);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteManualShipmentsAction(
  workCountry: WorkCountryCode,
  ids: string[]
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    const count = await softDeleteManualShipments(ids, workCountry);
    revalidate(workCountry);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function duplicateManualShipmentAction(
  workCountry: WorkCountryCode,
  id: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    const newId = await duplicateManualShipment(id, workCountry, me.id);
    if (!newId) return { ok: false, error: "הרשומה לא נמצאה" };
    revalidate(workCountry);
    return { ok: true, id: newId };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getManualShipmentAction(
  workCountry: WorkCountryCode,
  id: string
): Promise<{ ok: true; row: ManualShipmentDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS)) {
      return { ok: false, error: "אין הרשאה" };
    }
    requireShipmentCountryScope(workCountry);
    const row = await getManualShipment(id, workCountry);
    if (!row) return { ok: false, error: "הרשומה לא נמצאה" };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
