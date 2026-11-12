"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { summarizeFlowControlStatus } from "@/lib/flow-control/flow-control-status";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";

export type FlowWeekStatusBadgeProps = {
  drill: FlowWeekDrillPayload | null;
  /** מספר שבועות עם חריגה כספית בטווח. המתנה לספירה לא נספרת כאן. */
  rangeAlertCount?: number | null;
  onClick: () => void;
};

/**
 * תג סטטוס. המתנה לספירה מוצגת בנפרד ואינה נספרת כחריגה כספית.
 */
export function FlowWeekStatusBadge({
  drill,
  rangeAlertCount = null,
  onClick,
}: FlowWeekStatusBadgeProps) {
  if (!drill && rangeAlertCount == null) return null;

  const lines = drill ? getFlowWeekVarianceLines(drill) : [];
  const summary = summarizeFlowControlStatus(lines);

  let tone: "ok" | "warn" | "critical" = summary.tone;
  let label = summary.financialCount > 0 ? `🔴 ${summary.label}` : summary.waitingCount > 0 ? `🟡 ${summary.label}` : "🟢 תואם";

  if (rangeAlertCount != null && rangeAlertCount > 0) {
    tone = "critical";
    label = `🔴 ${rangeAlertCount} שבועות עם חריגה כספית`;
  } else if (!drill) {
    tone = "ok";
    label = "🟢 תואם";
  }

  return (
    <button
      type="button"
      className={`cfc-status-badge cfc-status-badge--${tone}`}
      onClick={onClick}
      title="פירוט סטטוס הערוצים"
    >
      {label}
    </button>
  );
}

export default FlowWeekStatusBadge;
