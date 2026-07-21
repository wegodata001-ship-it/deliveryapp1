"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  filterOrdersForDrill,
  loadProfitLossDashboard,
  rebuildTimeline,
} from "@/app/admin/reports/profit-loss/service";
import type {
  ProfitLossDashboard,
  ProfitLossDrillRequest,
  ProfitLossFilters,
  ProfitLossOrderRow,
  ProfitLossSeriesPoint,
} from "@/app/admin/reports/profit-loss/types";

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["view_reports"])) {
    throw new Error("אין הרשאה");
  }
}

export async function getProfitLossDashboardAction(
  filters: ProfitLossFilters = {},
): Promise<{ ok: true; data: ProfitLossDashboard } | { ok: false; error: string }> {
  try {
    await ensureAllowed();
    const data = await loadProfitLossDashboard(filters);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getProfitLossTimelineAction(
  filters: ProfitLossFilters,
  period: "day" | "week" | "month",
): Promise<{ ok: true; timeline: ProfitLossSeriesPoint[] } | { ok: false; error: string }> {
  try {
    await ensureAllowed();
    const data = await loadProfitLossDashboard(filters);
    return { ok: true, timeline: rebuildTimeline(data.orders, period) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getProfitLossDrillAction(
  filters: ProfitLossFilters,
  req: ProfitLossDrillRequest,
): Promise<
  | { ok: true; title: string; rows: ProfitLossOrderRow[] }
  | { ok: false; error: string }
> {
  try {
    await ensureAllowed();
    const data = await loadProfitLossDashboard(filters);
    const rows = filterOrdersForDrill(data, req.kind, req.id, req.period ?? "day");
    const title = drillTitle(req, rows.length);
    return { ok: true, title, rows };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function drillTitle(req: ProfitLossDrillRequest, count: number): string {
  const base: Record<string, string> = {
    kpi: "פירוט KPI",
    timeline: "פירוט תקופה",
    order: "פירוט הזמנה",
    customer: "פירוט לקוח",
    supplier: "פירוט ספק",
    city: "פירוט עיר",
    fx: "פירוט שער דולר",
    composition: "פירוט רכיב רווח",
    losing: "הזמנות מפסידות",
  };
  return `${base[req.kind] ?? "פירוט"} — ${req.id} (${count})`;
}
