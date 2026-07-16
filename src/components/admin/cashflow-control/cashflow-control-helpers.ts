import type { FlowWeekOverviewRow, FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { fcNum } from "@/components/admin/flow-control/shared";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { formatAhWeekLabel, getAhWeekRange, parseAhWeekNumber } from "@/lib/weeks/ah-week";

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
