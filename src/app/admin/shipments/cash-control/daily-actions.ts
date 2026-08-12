"use server";

import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { requireShipmentCountryScope } from "@/lib/shipment-country-scope";
import type { WorkCountryCode } from "@/lib/work-country";
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

async function assertView(workCountry: WorkCountryCode) {
  const me = await requireAuth();
  if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
    throw new Error("אין הרשאה");
  }
  requireShipmentCountryScope(workCountry);
  return me;
}

export async function getShipmentCashControlWeekSummaryAction(
  workCountry: WorkCountryCode,
  week: string,
): Promise<CashDailyWeekSummaryPayload | null> {
  await assertView(workCountry);
  const wk = week.trim();
  if (!wk) return null;
  const payload = await loadShipmentCashWeek(wk, workCountry);
  return mapShippingWeekToDailySummary(payload);
}

export async function getShipmentCashControlDayDetailAction(
  workCountry: WorkCountryCode,
  input: {
    week: string;
    dateYmd: string;
  },
): Promise<CashDailyDayDetailPayload | null> {
  await assertView(workCountry);
  const dateYmd = input.dateYmd.trim();
  if (!dateYmd) return null;
  const payload = await loadShipmentCashControl({ workCountry, dayDate: dateYmd });
  return mapShippingDayToDailyDetail(input.week.trim(), payload);
}

export async function listShipmentCashControlDayIntakesAction(
  workCountry: WorkCountryCode,
  input: {
    week: string;
    dateYmd: string;
    column: string;
  },
): Promise<CashDailyMethodDetailRow[]> {
  await assertView(workCountry);
  void input.week;
  const drill = await drilldownPayments(input.dateYmd.trim(), input.column.trim(), workCountry);
  return mapShippingPaymentsToMethodRows(drill.rows as import("./types").CashDrilldownPaymentRow[]);
}
