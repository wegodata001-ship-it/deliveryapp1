/**
 * CashCountSummaryService — מקור הנתונים הרשמי של בקרת תזרים (חלק 1).
 * קורא אך ורק מ-CashDailyDrawerCount (ספירת קופה מאושרת).
 * אין גישה ל-Payment.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CashWeekFlowLineId } from "@/lib/cash-control-week-flow";
import { allCashControlChannels, CHANNEL_DRAWER_FIELD } from "@/lib/cash-control-channel";
import {
  computeWeekTotalReceivedIls,
} from "@/lib/flow-control/flow-calculation-service";
import {
  dayNameHe,
  emptyDailyIntake,
  formatDailyDateDisplay,
  type CashDailyDrawerValues,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import { formatAhWeekLabel, getAhWeekRange, listWeekDayYmds } from "@/lib/weeks/ah-week";
import type { CashDailySummaryRowDto, CashDailyWeekSummaryPayload } from "@/app/admin/cash-control/daily-types";
import { cashControlKpiService } from "@/lib/finance-data";

export const FLOW_COUNTRY_LABEL = "טורקיה";

export type FlowWeekApprovedLine = {
  amount: number;
  daysCounted: number;
};

export type FlowWeekCashCountSummary = {
  approved: Record<CashWeekFlowLineId, FlowWeekApprovedLine>;
  totalApprovedIls: number;
  hasAnyCount: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function numDec(v: Prisma.Decimal | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number | Prisma.Decimal): string {
  const d = n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function drawerFromDb(row: {
  cashIls: Prisma.Decimal | null;
  cashUsd: Prisma.Decimal | null;
  checksIls: Prisma.Decimal | null;
  checksUsd?: Prisma.Decimal | null;
  creditIls: Prisma.Decimal | null;
  creditUsd?: Prisma.Decimal | null;
  transferIls: Prisma.Decimal | null;
  transferUsd?: Prisma.Decimal | null;
  otherIls?: Prisma.Decimal | null;
  otherUsd?: Prisma.Decimal | null;
} | null): CashDailyDrawerValues {
  if (!row) return {};
  const out: CashDailyDrawerValues = {};
  for (const channel of allCashControlChannels()) {
    const field = CHANNEL_DRAWER_FIELD[channel];
    const raw = row[field];
    out[channel] = raw != null ? numDec(raw) : null;
  }
  return out;
}

function drawerToTotals(drawer: CashDailyDrawerValues): CashDailyIntakeTotals {
  const out = emptyDailyIntake();
  for (const k of allCashControlChannels()) {
    const v = drawer[k];
    out[k] = v != null ? round2(v) : 0;
  }
  return out;
}

function drawerToDto(drawer: CashDailyDrawerValues): Partial<Record<CashDailyMethodId, string | null>> {
  return Object.fromEntries(
    allCashControlChannels().map((id) => [id, drawer[id] != null ? money(drawer[id]!) : null]),
  ) as Partial<Record<CashDailyMethodId, string | null>>;
}

function sumDrawer(a: CashDailyDrawerValues, b: CashDailyDrawerValues): CashDailyDrawerValues {
  const out: CashDailyDrawerValues = {};
  for (const k of allCashControlChannels()) {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) continue;
    out[k] = round2((av ?? 0) + (bv ?? 0));
  }
  return out;
}

function hasDrawerData(drawer: CashDailyDrawerValues): boolean {
  return Object.values(drawer).some((v) => v != null && v > 0);
}

const LINE_IDS = ["CASH_ILS", "CASH_USD", "CREDIT", "CHECK", "BANK_TRANSFER"] as CashWeekFlowLineId[];

/** מיפוי ערוץ יומי → שורת ספירת מנהל שבועית (ILS בלבד, מזומן לפי מטבע) */
function methodToLineId(method: CashDailyMethodId): CashWeekFlowLineId | null {
  if (method === "CASH_ILS" || method === "CASH_USD") return method;
  if (method === "CREDIT_CARD_ILS") return "CREDIT";
  if (method === "CHECK_ILS") return "CHECK";
  if (method === "BANK_TRANSFER_ILS") return "BANK_TRANSFER";
  return null;
}

export async function loadFlowWeekCashCountSummary(weekCode: string): Promise<FlowWeekCashCountSummary> {
  const wk = weekCode.trim();
  const drawerRows = await prisma.cashDailyDrawerCount.findMany({
    where: { weekCode: wk, countryCode: "TR" },
  });

  const approved = Object.fromEntries(
    LINE_IDS.map((id) => [id, { amount: 0, daysCounted: 0 }]),
  ) as Record<CashWeekFlowLineId, FlowWeekApprovedLine>;

  let hasAnyCount = false;

  for (const row of drawerRows) {
    const drawer = drawerFromDb(row);
    if (!hasDrawerData(drawer)) continue;
    hasAnyCount = true;
    for (const method of allCashControlChannels()) {
      const lineId = methodToLineId(method);
      if (!lineId) continue;
      const v = drawer[method];
      if (v != null && v > 0) {
        approved[lineId].amount = round2(approved[lineId].amount + v);
        approved[lineId].daysCounted += 1;
      }
    }
  }

  const totalApprovedIls = round2(
    approved.CASH_ILS.amount +
      approved.CREDIT.amount +
      approved.CHECK.amount +
      approved.BANK_TRANSFER.amount,
  );

  return { approved, totalApprovedIls, hasAnyCount };
}

/** טבלה שבועית — נתונים מאושרים מספירת קופה בלבד */
export async function loadFlowWeekApprovedSummary(week: string): Promise<CashDailyWeekSummaryPayload | null> {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) return null;

  const drawerRows = await prisma.cashDailyDrawerCount.findMany({
    where: { weekCode: wk, countryCode: "TR" },
  });
  const drawerByDay = new Map(drawerRows.map((d) => [d.countDate, drawerFromDb(d)]));

  let weekDrawer: CashDailyDrawerValues = {};
  const dayRows: CashDailySummaryRowDto[] = [];

  for (const dateYmd of listWeekDayYmds(wk)) {
    const drawer = drawerByDay.get(dateYmd) ?? {};
    weekDrawer = sumDrawer(weekDrawer, drawer);
    const totals = drawerToTotals(drawer);
    const totalReceived = computeWeekTotalReceivedIls(totals);
    const saved = hasDrawerData(drawer);

    dayRows.push({
      dateYmd,
      dayName: dayNameHe(dateYmd),
      dateDisplay: formatDailyDateDisplay(dateYmd),
      weekCode: wk,
      countryLabel: FLOW_COUNTRY_LABEL,
      intake: Object.fromEntries(allCashControlChannels().map((id) => [id, money(totals[id])])) as Record<
        CashDailyMethodId,
        string
      >,
      drawer: drawerToDto(drawer),
      totalReceived: money(totalReceived),
      expensesIls: money(0),
      expensesUsd: money(0),
      diff: null,
      status: saved ? "ok" : "pending",
    });
  }

  const weekTotals = drawerToTotals(weekDrawer);
  const weekTotalReceived = computeWeekTotalReceivedIls(weekTotals);

  dayRows.push({
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode: wk,
    countryLabel: FLOW_COUNTRY_LABEL,
    intake: Object.fromEntries(allCashControlChannels().map((id) => [id, money(weekTotals[id])])) as Record<
      CashDailyMethodId,
      string
    >,
    drawer: drawerToDto(weekDrawer),
    totalReceived: money(weekTotalReceived),
    expensesIls: money(0),
    expensesUsd: money(0),
    diff: null,
    status: "ok",
    isTotal: true,
  });

  return {
    week: wk,
    weekLabel: formatAhWeekLabel(wk),
    from: range.from,
    to: range.to,
    rows: dayRows,
    kpi: cashControlKpiService.buildFromWeekAggregates({
      weekCode: wk,
      channelIntake: weekTotals,
      expensesUsd: 0,
      expensesIls: 0,
    }),
  };
}
