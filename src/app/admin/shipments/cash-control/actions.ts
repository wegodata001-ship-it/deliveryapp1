"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import {
  requireShipmentCountryScope,
  shipmentCountrySlugFromWorkCountry,
} from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
import type { PaymentMethodValue } from "@/app/admin/shipments/types";
import type {
  CashControlWeekPayload,
  CashDrilldownPayload,
  ShipmentCashControlFilter,
  ShipmentCashControlPayload,
  ShipmentCashControlRow,
  ShipmentCashDayDto,
  ShipmentCashExpenseCategory,
  ShipmentCashExpenseDto,
  ShipmentCashHistoryEntry,
} from "@/app/admin/shipments/cash-control/types";
import {
  addShipmentCashExpense,
  closeShipmentCashDay,
  deleteShipmentCashExpense,
  drilldownExpenses,
  drilldownPayments,
  findActiveOpenShipmentCashDay,
  getOrOpenShipmentCashDay,
  intakeShipmentFeePayment,
  loadShipmentCashControl,
  loadShipmentCashHistory,
  loadShipmentCashWeek,
  reopenShipmentCashDay,
  saveManualCollected,
  saveShipmentCashCounts,
} from "@/app/admin/shipments/cash-control/service";

const VIEW_PERMS = ["manage_shipments", "view_shipments"];
const WRITE_PERMS = ["manage_shipments"];

function revalidate(workCountry: WorkCountryCode) {
  const slug = shipmentCountrySlugFromWorkCountry(workCountry);
  revalidatePath(`/admin/shipments/${slug}`);
  revalidatePath(`/admin/shipments/${slug}/cash-control`);
  revalidatePath(`/admin/shipments/${slug}/control`);
}

export async function loadShipmentCashControlAction(
  filter: ShipmentCashControlFilter,
): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(filter.workCountry);
    const data = await loadShipmentCashControl(filter);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadShipmentCashWeekAction(
  workCountry: WorkCountryCode,
  weekCode: string,
): Promise<{ ok: true; data: CashControlWeekPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const data = await loadShipmentCashWeek(weekCode, workCountry);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function drilldownPaymentsAction(
  workCountry: WorkCountryCode,
  dayDate: string,
  method: string,
): Promise<{ ok: true; data: CashDrilldownPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const data = await drilldownPayments(dayDate, method, workCountry);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function drilldownExpensesAction(
  workCountry: WorkCountryCode,
  dayDate: string,
  method: string,
): Promise<{ ok: true; data: CashDrilldownPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const data = await drilldownExpenses(dayDate, method, workCountry);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function openShipmentCashDayAction(
  workCountry: WorkCountryCode,
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto; reusedExistingOpen: boolean } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const before = await findActiveOpenShipmentCashDay(workCountry);
    const day = await getOrOpenShipmentCashDay(dayDate, me.id, workCountry);
    const reusedExistingOpen = Boolean(before && before.id === day.id);
    revalidate(workCountry);
    return { ok: true, day, reusedExistingOpen };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadShipmentCashHistoryAction(
  shipmentRecordId: string,
): Promise<{ ok: true; entries: ShipmentCashHistoryEntry[] } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const entries = await loadShipmentCashHistory(shipmentRecordId);
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function closeShipmentCashDayAction(
  workCountry: WorkCountryCode,
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const day = await closeShipmentCashDay(dayDate, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, day };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reopenShipmentCashDayAction(
  workCountry: WorkCountryCode,
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const day = await reopenShipmentCashDay(dayDate, me.id, workCountry);
    revalidate(workCountry);
    return { ok: true, day };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function intakeShipmentFeePaymentAction(
  workCountry: WorkCountryCode,
  input: {
    shipmentRecordId: string;
    amountIls: number;
    method: PaymentMethodValue;
    paymentDate?: string | null;
    notes?: string | null;
    allowOverpay?: boolean;
  },
): Promise<{ ok: true; row: ShipmentCashControlRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const row = await intakeShipmentFeePayment({
      ...input,
      workCountry,
      createdById: me.id,
      isAdmin: isAdminUser(me),
    });
    revalidate(workCountry);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function addShipmentCashExpenseAction(
  workCountry: WorkCountryCode,
  input: {
    dayDate: string;
    category: ShipmentCashExpenseCategory;
    paymentMethod: string;
    amountIls: number;
    notes?: string | null;
  },
): Promise<{ ok: true; expense: ShipmentCashExpenseDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const expense = await addShipmentCashExpense({ ...input, workCountry, createdById: me.id });
    revalidate(workCountry);
    return { ok: true, expense };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function deleteShipmentCashExpenseAction(
  expenseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    await deleteShipmentCashExpense(expenseId, me.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveShipmentCashCountsAction(
  workCountry: WorkCountryCode,
  input: {
    dayDate: string;
    counts: Array<{ method: string; countedIls: number }>;
  },
): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const data = await saveShipmentCashCounts({
      dayDate: input.dayDate,
      counts: input.counts,
      createdById: me.id,
      workCountry,
    });
    revalidate(workCountry);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveManualCollectedAction(
  workCountry: WorkCountryCode,
  input: {
    dayDate: string;
    method: string;
    amountIls: number;
  },
): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    requireShipmentCountryScope(workCountry);
    const data = await saveManualCollected({ ...input, workCountry, createdById: me.id });
    revalidate(workCountry);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
