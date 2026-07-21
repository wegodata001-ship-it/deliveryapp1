"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { deriveWeekStatus } from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";

export type FlowWeekStatusBadgeProps = {
  drill: FlowWeekDrillPayload | null;
  /** מספר שבועות חריגים בטווח (אופציונלי — כשטווח > שבוע) */
  rangeAlertCount?: number | null;
  onClick: () => void;
};

/**
 * תג קומפקטי במקום באנר אדום גדול — לחיצה פותחת רשימת חריגות.
 */
export function FlowWeekStatusBadge({
  drill,
  rangeAlertCount = null,
  onClick,
}: FlowWeekStatusBadgeProps) {
  if (!drill && rangeAlertCount == null) return null;

  const lines = drill ? getFlowWeekVarianceLines(drill) : [];
  const problemLines = lines.filter(
    (l) =>
      l.cashControlStatus === "SHORTAGE" ||
      l.cashControlStatus === "SURPLUS" ||
      l.cashControlStatus === "WAITING_FOR_COUNT",
  );
  const status = drill ? deriveWeekStatus(drill) : null;

  let tone: "ok" | "warn" | "critical" = "ok";
  let label = "🟢 אין חריגות";

  if (rangeAlertCount != null && rangeAlertCount > 0) {
    tone = "critical";
    label = `🔴 נמצאו ${rangeAlertCount} שבועות חריגים`;
  } else if (status?.status === "critical" || problemLines.length > 0) {
    tone = "critical";
    const n = Math.max(problemLines.length, 1);
    label = `🔴 נמצאו ${n} חריגות`;
  } else if (status?.status === "warn") {
    tone = "warn";
    label = `🟡 ${status.label}`;
  }

  return (
    <button
      type="button"
      className={`cfc-status-badge cfc-status-badge--${tone}`}
      onClick={onClick}
      title="לחצו לפירוט החריגות"
    >
      {label}
    </button>
  );
}

export default FlowWeekStatusBadge;
