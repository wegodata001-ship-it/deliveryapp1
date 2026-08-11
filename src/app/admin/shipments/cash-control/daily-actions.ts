"use server";

import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import type {
  CashDailyDayDetailPayload,
  CashDailyMethodDetailRow,
  CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-types";
import {
  drilldownPayments,
  loadShipmentCashControl,
  loadShipmentCashWeek,
} from "@/app/admin/shipments/cash-control/service";
import {
  mapShippingDayToDailyDetail,
  mapShippingPaymentsToMethodRows,
  mapShippingWeekToDailySummary,
} from "@/app/admin/shipments/cash-control/daily-adapter";

const PERMS = ["manage_shipments", "view_shipments"];

async function assertView() {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export async function getShipmentCashControlWeekSummaryAction(
  week: string,
): Promise<CashDailyWeekSummaryPayload | null> {
  await assertView();
  const wk = week.trim();
  if (!wk) return null;
  const payload = await loadShipmentCashWeek(wk);
  return mapShippingWeekToDailySummary(payload);
}

export async function getShipmentCashControlDayDetailAction(input: {
  week: string;
  dateYmd: string;
}): Promise<CashDailyDayDetailPayload | null> {
  await assertView();
  const dateYmd = input.dateYmd.trim();
  if (!dateYmd) return null;
  const payload = await loadShipmentCashControl({ dayDate: dateYmd });
  return mapShippingDayToDailyDetail(input.week.trim(), payload);
}

export async function listShipmentCashControlDayIntakesAction(input: {
  week: string;
  dateYmd: string;
  column: string;
}): Promise<CashDailyMethodDetailRow[]> {
  await assertView();
  void input.week;
  const drill = await drilldownPayments(input.dateYmd.trim(), input.column.trim());
  return mapShippingPaymentsToMethodRows(drill.rows as import("./types").CashDrilldownPaymentRow[]);
}
