"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
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

function revalidate() {
  revalidatePath("/admin/shipments");
  revalidatePath("/admin/shipments/cash-control");
  revalidatePath("/admin/shipments/control");
}

export async function loadShipmentCashControlAction(
  filter: ShipmentCashControlFilter,
): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await loadShipmentCashControl(filter);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function loadShipmentCashWeekAction(
  weekCode: string,
): Promise<{ ok: true; data: CashControlWeekPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await loadShipmentCashWeek(weekCode);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function drilldownPaymentsAction(
  dayDate: string,
  method: string,
): Promise<{ ok: true; data: CashDrilldownPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await drilldownPayments(dayDate, method);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function drilldownExpensesAction(
  dayDate: string,
  method: string,
): Promise<{ ok: true; data: CashDrilldownPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, VIEW_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await drilldownExpenses(dayDate, method);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function openShipmentCashDayAction(
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto; reusedExistingOpen: boolean } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const before = await findActiveOpenShipmentCashDay();
    const day = await getOrOpenShipmentCashDay(dayDate, me.id);
    const reusedExistingOpen = Boolean(before && before.id === day.id);
    revalidate();
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
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const day = await closeShipmentCashDay(dayDate, me.id);
    revalidate();
    return { ok: true, day };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function reopenShipmentCashDayAction(
  dayDate: string,
): Promise<{ ok: true; day: ShipmentCashDayDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const day = await reopenShipmentCashDay(dayDate, me.id);
    revalidate();
    return { ok: true, day };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function intakeShipmentFeePaymentAction(input: {
  shipmentRecordId: string;
  amountIls: number;
  method: PaymentMethodValue;
  paymentDate?: string | null;
  notes?: string | null;
  allowOverpay?: boolean;
}): Promise<{ ok: true; row: ShipmentCashControlRow } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const row = await intakeShipmentFeePayment({ ...input, createdById: me.id, isAdmin: isAdminUser(me) });
    revalidate();
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function addShipmentCashExpenseAction(input: {
  dayDate: string;
  category: ShipmentCashExpenseCategory;
  paymentMethod: string;
  amountIls: number;
  notes?: string | null;
}): Promise<{ ok: true; expense: ShipmentCashExpenseDto } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const expense = await addShipmentCashExpense({ ...input, createdById: me.id });
    revalidate();
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
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveShipmentCashCountsAction(input: {
  dayDate: string;
  counts: Array<{ method: string; countedIls: number }>;
}): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await saveShipmentCashCounts({ dayDate: input.dayDate, counts: input.counts, createdById: me.id });
    revalidate();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function saveManualCollectedAction(input: {
  dayDate: string;
  method: string;
  amountIls: number;
}): Promise<{ ok: true; data: ShipmentCashControlPayload } | { ok: false; error: string }> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, WRITE_PERMS))
      return { ok: false, error: "אין הרשאה" };
    const data = await saveManualCollected({ ...input, createdById: me.id });
    revalidate();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
