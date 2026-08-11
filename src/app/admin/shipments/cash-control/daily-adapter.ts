import type {
  CashDailyDayDetailPayload,
  CashDailyMethodDetailRow,
  CashDailySummaryRowDto,
  CashDailyWeekSummaryPayload,
} from "@/app/admin/cash-control/daily-types";
import type { CashDailyStatusKind } from "@/lib/cash-control-daily";
import { CASH_DAILY_DIFF_THRESHOLD } from "@/lib/cash-control-daily";
import type { CashControlKpiView } from "@/lib/finance-data";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import {
  CASH_CONTROL_METHODS,
  CASH_CONTROL_METHOD_LABELS,
} from "@/app/admin/shipments/types";
import { round2 } from "@/app/admin/shipments/cash-control/ssot";
import type {
  CashControlDayRow,
  CashControlWeekPayload,
  CashDrilldownPaymentRow,
  ShipmentCashControlPayload,
} from "@/app/admin/shipments/cash-control/types";
import { SHIPPING_CASH_TABLE_METHODS } from "@/components/admin/cash-control/shipping-table-config";

function money(n: number): string {
  return round2(n).toFixed(2);
}

function formatDateDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function mapDayStatus(day: CashControlDayRow): CashDailyStatusKind {
  const countedValues = SHIPPING_CASH_TABLE_METHODS.map((m) => day.countedByMethod[m]);
  if (countedValues.every((v) => v == null)) return "pending";
  const diffs = SHIPPING_CASH_TABLE_METHODS.map((m) => Math.abs(day.differenceByMethod[m] ?? 0));
  const maxAbs = Math.max(...diffs, 0);
  if (maxAbs <= 0.009) return "ok";
  if (maxAbs <= CASH_DAILY_DIFF_THRESHOLD.ILS) return "warn";
  return "critical";
}

function buildIntakeDrawer(day: CashControlDayRow): {
  intake: Record<string, string>;
  drawer: Partial<Record<string, string | null>>;
} {
  const intake: Record<string, string> = {};
  const drawer: Partial<Record<string, string | null>> = {};
  for (const m of CASH_CONTROL_METHODS) {
    intake[m.value] = money(day.byMethod[m.value] ?? 0);
    const counted = day.countedByMethod[m.value];
    drawer[m.value] = counted != null ? money(counted) : null;
  }
  return { intake, drawer };
}

function aggregateWeekIntakeDrawer(days: CashControlDayRow[]): {
  intake: Record<string, string>;
  drawer: Partial<Record<string, string | null>>;
} {
  const intakeTotals: Record<string, number> = {};
  const drawerTotals: Record<string, number | null> = {};
  for (const m of CASH_CONTROL_METHODS) {
    intakeTotals[m.value] = 0;
    drawerTotals[m.value] = null;
  }
  for (const day of days) {
    for (const m of CASH_CONTROL_METHODS) {
      intakeTotals[m.value] = round2(intakeTotals[m.value] + (day.byMethod[m.value] ?? 0));
      const counted = day.countedByMethod[m.value];
      if (counted != null) {
        drawerTotals[m.value] = round2((drawerTotals[m.value] ?? 0) + counted);
      }
    }
  }
  const intake: Record<string, string> = {};
  const drawer: Partial<Record<string, string | null>> = {};
  for (const m of CASH_CONTROL_METHODS) {
    intake[m.value] = money(intakeTotals[m.value]);
    drawer[m.value] = drawerTotals[m.value] != null ? money(drawerTotals[m.value]!) : null;
  }
  return { intake, drawer };
}

function sumCounted(day: CashControlDayRow): number {
  return round2(
    SHIPPING_CASH_TABLE_METHODS.reduce((s, m) => s + (day.countedByMethod[m] ?? 0), 0),
  );
}

export function mapShippingWeekToDailySummary(
  week: CashControlWeekPayload,
): CashDailyWeekSummaryPayload {
  const range = getAhWeekRange(week.weekCode);
  const dayRows: CashDailySummaryRowDto[] = week.days.map((day) => {
    const { intake, drawer } = buildIntakeDrawer(day);
    const countedTotal = sumCounted(day);
    const aggDiff =
      countedTotal > 0 || Object.values(day.countedByMethod).some((v) => v != null)
        ? round2(countedTotal - day.totalCollected)
        : null;
    const countSaved = Object.values(day.countedByMethod).some((v) => v != null);

    return {
      dateYmd: day.dayDate,
      dayName: day.dayLabel,
      dateDisplay: formatDateDisplay(day.dayDate),
      weekCode: week.weekCode,
      countryLabel: "משלוחים",
      intake: intake as CashDailySummaryRowDto["intake"],
      drawer: drawer as CashDailySummaryRowDto["drawer"],
      totalReceived: money(day.totalCollected),
      totalReceivedIls: money(day.totalCollected),
      totalReceivedUsd: "0.00",
      expensesIls: money(day.totalExpenses),
      expensesUsd: "0.00",
      diff: aggDiff != null ? money(aggDiff) : null,
      diffCurrency: "ILS",
      status: mapDayStatus(day),
      countSaved,
      countedAtHm: null,
      countedByName: null,
    };
  });

  const weekAgg = aggregateWeekIntakeDrawer(week.days);
  dayRows.push({
    dateYmd: "",
    dayName: "",
    dateDisplay: 'סה"כ שבוע',
    weekCode: week.weekCode,
    countryLabel: "משלוחים",
    intake: weekAgg.intake as CashDailySummaryRowDto["intake"],
    drawer: weekAgg.drawer as CashDailySummaryRowDto["drawer"],
    totalReceived: money(week.totalCollected),
    totalReceivedIls: money(week.totalCollected),
    totalReceivedUsd: "0.00",
    expensesIls: money(week.totalExpenses),
    expensesUsd: "0.00",
    diff: null,
    status: "ok",
    isTotal: true,
  });

  const kpi: CashControlKpiView = {
    weekCode: week.weekCode,
    totalReceiptsUsd: 0,
    totalReceiptsIls: week.totalCollected,
    totalExpensesUsd: 0,
    totalExpensesIls: week.totalExpenses,
    bankPaidUsd: 0,
    bankPaidIls: round2(
      (week.totalByMethod.BANK_TRANSFER ?? 0) +
        (week.totalByMethod.CHECK ?? 0) +
        (week.totalByMethod.CREDIT ?? 0),
    ),
  };

  return {
    week: week.weekCode,
    weekLabel: week.weekLabel,
    from: range?.from ?? week.days[0]?.dayDate ?? "",
    to: range?.to ?? week.days[week.days.length - 1]?.dayDate ?? "",
    rows: dayRows,
    kpi,
  };
}

export function mapShippingDayToDailyDetail(
  weekCode: string,
  payload: ShipmentCashControlPayload,
): CashDailyDayDetailPayload {
  const intake: Record<string, string> = {};
  const drawer: Partial<Record<string, string | null>> = {};
  const reconciliation: CashDailyDayDetailPayload["reconciliation"] = [];

  for (const line of payload.methods) {
    intake[line.method] = money(line.collectedIls);
    drawer[line.method] = line.countedIls != null ? money(line.countedIls) : null;
    reconciliation.push({
      method: line.method as CashDailyDayDetailPayload["reconciliation"][number]["method"],
      label: line.label,
      currency: "ILS",
      grossReceived: money(line.collectedIls),
      expense: money(line.expensesIls),
      received: money(line.balanceIls),
      counted: line.countedIls != null ? money(line.countedIls) : null,
      diff: line.countedIls != null ? money(line.differenceIls) : null,
      status:
        line.status === "ok"
          ? "ok"
          : line.status === "small"
            ? "warn"
            : line.status === "large"
              ? "critical"
              : "pending",
    });
  }

  const dayName =
    payload.dayDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.dayDate)
      ? new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(
          new Date(`${payload.dayDate}T12:00:00`),
        )
      : "";

  return {
    dateYmd: payload.dayDate,
    dateDisplay: formatDateDisplay(payload.dayDate),
    dayName,
    weekCode,
    intake: intake as CashDailyDayDetailPayload["intake"],
    drawer: drawer as CashDailyDayDetailPayload["drawer"],
    countSaved: payload.methods.some((m) => m.countedIls != null),
    countedAtHm: null,
    countedByName: null,
    expensesIls: money(payload.summary.expensesIls),
    expensesUsd: "0.00",
    expenses: payload.expenses.map((e) => ({
      id: e.id,
      timeHm: e.createdAt.slice(11, 16),
      reason: e.category,
      reasonLabel: e.categoryLabel,
      notes: e.notes,
      currency: "ILS" as const,
      paymentMethod: e.paymentMethod,
      paymentMethodLabel: e.paymentMethodLabel,
      amount: money(e.amountIls),
      createdByName: e.createdByName,
      documentCount: 0,
      status: "ACTIVE" as const,
    })),
    reconciliation,
  };
}

export function mapShippingPaymentsToMethodRows(
  rows: CashDrilldownPaymentRow[],
): CashDailyMethodDetailRow[] {
  return rows.map((r) => ({
    paymentId: r.id,
    paymentCode: null,
    orderId: null,
    customerId: null,
    customerName: r.customerName,
    recordedByName: null,
    timeHm: r.time,
    amount: money(r.amountIls),
    hasDocument: false,
    documentPreviewable: false,
    previewDocumentId: null,
    reviewed: false,
  }));
}

export function shippingMethodLabel(method: string): string {
  return CASH_CONTROL_METHOD_LABELS[method] ?? method;
}
