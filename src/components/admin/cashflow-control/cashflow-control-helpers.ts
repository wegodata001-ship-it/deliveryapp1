import type { FlowWeekOverviewRow, FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { fcNum } from "@/components/admin/flow-control/shared";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { formatAhWeekLabel, getAhWeekRange, parseAhWeekNumber } from "@/lib/weeks/ah-week";
import { toAhWeekCode } from "@/lib/weeks/ah-week-nav";

export type WeekRowStatus = "ok" | "pending" | "alert";

export function money(currency: "ILS" | "USD", value: string | number | null | undefined): string {
  const n = typeof value === "number" ? value : fcNum(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "—";
  return fmtDailyMoney(currency, n);
}

export function moneyBoth(ils: string | null | undefined, usd: string | null | undefined): string {
  const i = money("ILS", ils);
  const u = money("USD", usd);
  if (i === "—" && u === "—") return "—";
  if (i === "—") return u;
  if (u === "—") return i;
  return `${i} · ${u}`;
}

export function weekDateRange(week: string, weekLabel: string | null): string {
  if (weekLabel?.trim()) return weekLabel.trim();
  return formatAhWeekLabel(week) ?? "—";
}

export function weekYear(week: string): number {
  const range = getAhWeekRange(week);
  if (range?.from) return Number(range.from.slice(0, 4));
  return new Date().getFullYear();
}

export function sumManagerIls(row: FlowWeekOverviewRow): number {
  return (
    fcNum(row.manager.CASH_ILS) +
    fcNum(row.manager.CHECK) +
    fcNum(row.manager.CREDIT) +
    fcNum(row.manager.BANK_TRANSFER)
  );
}

export function sumManagerUsd(row: FlowWeekOverviewRow): number {
  return fcNum(row.manager.CASH_USD);
}

export function weekDiffIls(row: FlowWeekOverviewRow): number {
  return fcNum(row.totalReceivedIls) - sumManagerIls(row);
}

export function weekFxNetIls(row: FlowWeekOverviewRow): number {
  return fcNum(row.fxProfitIls) - fcNum(row.fxLossIls);
}

/** סטטוס תצוגה בלבד — נגזר מנתונים קיימים, ללא חישובים חדשים עסקיים */
export function deriveWeekStatus(row: FlowWeekOverviewRow): WeekRowStatus {
  if (!row.hasData) return "pending";
  const turkey = row.turkeyBalanceStatus;
  if (turkey === "NO_COUNT" || turkey === "AWAITING_TRANSFER" || turkey === "COUNT_SAVED") {
    return "pending";
  }
  const diff = Math.abs(weekDiffIls(row));
  const turkeyClose = fcNum(row.turkeyClosingUsd);
  if (diff > 50 || turkeyClose > 0.01 || turkey === "HAS_ADJUSTMENT") return "alert";
  return "ok";
}

export function statusLabel(status: WeekRowStatus): string {
  if (status === "ok") return "תקין";
  if (status === "pending") return "חסר בדיקה";
  return "חריג";
}

export function matchPercent(received: number, counted: number): number {
  if (received <= 0.01 && counted <= 0.01) return 100;
  if (received <= 0.01) return 0;
  return Math.max(0, Math.min(100, Math.round((counted / received) * 100)));
}

export function matchTone(pct: number): "ok" | "warn" | "bad" {
  if (pct >= 98) return "ok";
  if (pct >= 90) return "warn";
  return "bad";
}

export function filterWeeksByYear(rows: FlowWeekOverviewRow[], year: number | "all"): FlowWeekOverviewRow[] {
  if (year === "all") return rows;
  return rows.filter((r) => weekYear(r.week) === year);
}

/** קודי שבוע בטווח כולל (מהחדש לישן). מנרמל אם from > to. */
export function weekCodesInRange(fromWeek: string, toWeek: string): string[] {
  let a = parseAhWeekNumber(fromWeek) ?? 1;
  let b = parseAhWeekNumber(toWeek) ?? a;
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  for (let n = b; n >= a; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

export function filterWeeksByRange(
  rows: FlowWeekOverviewRow[],
  fromWeek: string,
  toWeek: string,
): FlowWeekOverviewRow[] {
  const set = new Set(weekCodesInRange(fromWeek, toWeek));
  return rows.filter((r) => set.has(r.week));
}

export type FlowRangeAggregate = {
  fromWeek: string;
  toWeek: string;
  weekCount: number;
  totalReceivedIls: number;
  fxPurchaseIls: number;
  fxPurchaseUsd: number;
  fxProfitIls: number;
  fxLossIls: number;
  fxNetIls: number;
  expensesIls: number;
  turkeyTransferredUsd: number;
  turkeyClosingUsd: number;
  alertWeekCount: number;
  pendingWeekCount: number;
  okWeekCount: number;
};

/** סיכום מצטבר מטבלת הסקירה — לתצוגת טווח שבועות */
export function aggregateOverviewRange(rows: FlowWeekOverviewRow[]): FlowRangeAggregate | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) => (parseAhWeekNumber(a.week) ?? 0) - (parseAhWeekNumber(b.week) ?? 0),
  );
  let totalReceivedIls = 0;
  let fxPurchaseIls = 0;
  let fxPurchaseUsd = 0;
  let fxProfitIls = 0;
  let fxLossIls = 0;
  let expensesIls = 0;
  let turkeyTransferredUsd = 0;
  let turkeyClosingUsd = 0;
  let alertWeekCount = 0;
  let pendingWeekCount = 0;
  let okWeekCount = 0;
  for (const r of sorted) {
    totalReceivedIls += fcNum(r.totalReceivedIls);
    fxPurchaseIls += fcNum(r.fxPurchaseIls);
    fxPurchaseUsd += fcNum(r.fxPurchaseUsd);
    fxProfitIls += fcNum(r.fxProfitIls);
    fxLossIls += fcNum(r.fxLossIls);
    expensesIls += fcNum(r.expensesIls);
    turkeyTransferredUsd += fcNum(r.turkeyTransferredUsd);
    turkeyClosingUsd += fcNum(r.turkeyClosingUsd);
    const st = deriveWeekStatus(r);
    if (st === "alert") alertWeekCount += 1;
    else if (st === "pending") pendingWeekCount += 1;
    else okWeekCount += 1;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    fromWeek: sorted[0]!.week,
    toWeek: sorted[sorted.length - 1]!.week,
    weekCount: sorted.length,
    totalReceivedIls: round2(totalReceivedIls),
    fxPurchaseIls: round2(fxPurchaseIls),
    fxPurchaseUsd: round2(fxPurchaseUsd),
    fxProfitIls: round2(fxProfitIls),
    fxLossIls: round2(fxLossIls),
    fxNetIls: round2(fxProfitIls - fxLossIls),
    expensesIls: round2(expensesIls),
    turkeyTransferredUsd: round2(turkeyTransferredUsd),
    turkeyClosingUsd: round2(turkeyClosingUsd),
    alertWeekCount,
    pendingWeekCount,
    okWeekCount,
  };
}

export function uniqueYears(rows: FlowWeekOverviewRow[]): number[] {
  const set = new Set<number>();
  for (const r of rows) set.add(weekYear(r.week));
  const active = parseAhWeekNumber(rows[0]?.week ?? "") != null ? weekYear(rows[0]!.week) : new Date().getFullYear();
  set.add(active);
  return [...set].sort((a, b) => b - a);
}

export function drawerLine(
  drill: FlowWeekDrillPayload | null,
  key: keyof FlowWeekDrillPayload["paymentIntake"],
): string {
  if (!drill) return "—";
  return money(key.includes("USD") ? "USD" : "ILS", drill.paymentIntake[key]);
}
