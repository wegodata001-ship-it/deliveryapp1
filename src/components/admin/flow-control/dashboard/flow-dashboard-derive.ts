/**
 * עזרי תצוגה לדשבורד בקרת תזרים — אגרגציה ל-UI בלבד, ללא שינוי לוגיקה עסקית.
 */

import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { FLOW_PAYMENT_COLUMNS } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type FlowWeekUiStatus = "ok" | "warn" | "critical";

export type FlowWeekStatusView = {
  status: FlowWeekUiStatus;
  label: string;
  dot: string;
};

export function deriveWeekStatus(drill: FlowWeekDrillPayload): FlowWeekStatusView {
  const days = drill.dailyCounts;
  if (days.length === 0) {
    return { status: "warn", label: "חסר בדיקה", dot: "🟡" };
  }
  const hasCritical = days.some((d) => d.status === "critical");
  const hasWarn = days.some((d) => d.status === "warn");
  const hasPending = days.some((d) => d.status === "pending" || !d.countSaved);
  const turkeyDebt = drill.flow.turkeyDebtStatus === "debt" && fcNum(drill.flow.turkeyDebtUsd) > 0.02;

  if (hasCritical || turkeyDebt) {
    return { status: "critical", label: "נמצאו חריגות", dot: "🔴" };
  }
  if (hasWarn || hasPending) {
    return { status: "warn", label: "חסר בדיקה", dot: "🟡" };
  }
  return { status: "ok", label: "השבוע תקין", dot: "🟢" };
}

/** אחוז ימים עם סטטוס ok מבין ימים שנספרו */
export function deriveMatchPercent(drill: FlowWeekDrillPayload): number {
  const counted = drill.dailyCounts.filter((d) => d.countSaved);
  if (counted.length === 0) return 0;
  const ok = counted.filter((d) => d.status === "ok").length;
  return Math.round((ok / counted.length) * 100);
}

export function deriveMatchStatus(pct: number): FlowWeekUiStatus {
  if (pct >= 98) return "ok";
  if (pct >= 85) return "warn";
  return "critical";
}

export function deriveTotalCountedIls(drill: FlowWeekDrillPayload): number {
  let sum = 0;
  for (const row of drill.dailyCounts) {
    sum += fcNum(row.totalReceived);
  }
  return Math.round(sum * 100) / 100;
}

export function deriveTotalDrawerIls(drill: FlowWeekDrillPayload): number {
  let sum = 0;
  for (const row of drill.dailyCounts) {
    for (const m of FLOW_PAYMENT_COLUMNS) {
      const v = row.drawer[m];
      if (v != null) sum += fcNum(v);
    }
  }
  return Math.round(sum * 100) / 100;
}

export function deriveWeekDiffIls(drill: FlowWeekDrillPayload): number {
  const received = fcNum(drill.flow.kpis.totalReceivedIls);
  const counted = deriveTotalDrawerIls(drill) || deriveTotalCountedIls(drill);
  return Math.round((received - counted) * 100) / 100;
}

export function deriveFxNetIls(drill: FlowWeekDrillPayload): number {
  return Math.round((fcNum(drill.flow.kpis.fxProfitIls) - fcNum(drill.flow.kpis.fxLossIls)) * 100) / 100;
}

export function fmtHeroIls(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return fmtDailyMoney("ILS", n);
}

export function fmtHeroUsd(n: number): string {
  if (Math.abs(n) < 0.005) return "—";
  return fmtDailyMoney("USD", n);
}

export function fmtHeroDual(ils: number, usd: number): string {
  const parts: string[] = [];
  if (Math.abs(ils) >= 0.005) parts.push(fmtDailyMoney("ILS", ils));
  if (Math.abs(usd) >= 0.005) parts.push(fmtDailyMoney("USD", usd));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function managerCountHero(drill: FlowWeekDrillPayload): string {
  const ils = fcNum(drill.flow.counted.CASH_ILS);
  const usd = fcNum(drill.flow.counted.CASH_USD);
  if (ils <= 0 && usd <= 0) return "—";
  return fmtHeroDual(ils, usd);
}

export function intakeDistribution(drill: FlowWeekDrillPayload): { label: string; amount: number; pct: number }[] {
  const total = fcNum(drill.flow.kpis.totalReceivedIls);
  if (total <= 0) return [];
  const labels: Record<string, string> = {
    CASH_ILS: "מזומן ₪",
    CASH_USD: "מזומן $",
    BANK_TRANSFER: "העברות",
    CHECK: "צ'קים",
    CREDIT: "אשראי",
    OTHER: "אחר",
  };
  const out: { label: string; amount: number; pct: number }[] = [];
  for (const m of FLOW_PAYMENT_COLUMNS) {
    const amt = fcNum(drill.paymentIntake[m]);
    if (amt <= 0) continue;
    out.push({ label: labels[m] ?? m, amount: amt, pct: Math.round((amt / total) * 100) });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export function overviewRowForWeek(
  overview: FlowWeekOverviewRow[],
  week: string,
): FlowWeekOverviewRow | null {
  return overview.find((r) => r.week === week) ?? null;
}
