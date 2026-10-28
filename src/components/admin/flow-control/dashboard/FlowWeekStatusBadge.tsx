"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { deriveWeekStatus } from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";
import { buildFlowBusinessReconciliation } from "@/lib/flow-control/flow-week-business-reconciliation";

export type FlowWeekStatusBadgeProps = {
  drill: FlowWeekDrillPayload | null;
  /** מספר שבועות חריגים בטווח (אופציונלי — כשטווח > שבוע) */
  rangeAlertCount?: number | null;
  onClick: () => void;
};

/**
 * תג קומפקטי — מונה רק חריגות מאומתות (לא «אין ספירה» לכל ערוץ).
 */
export function FlowWeekStatusBadge({
  drill,
  rangeAlertCount = null,
  onClick,
}: FlowWeekStatusBadgeProps) {
  if (!drill && rangeAlertCount == null) return null;

  const recon = drill
    ? buildFlowBusinessReconciliation({
        drill,
        overview: null,
        week: drill.week,
      })
    : null;
  const verified = recon?.verifiedExceptionCount ?? 0;
  const pending = recon?.pendingVerificationCount ?? 0;
  const status = drill ? deriveWeekStatus(drill) : null;

  let tone: "ok" | "warn" | "critical" = "ok";
  let label = "🟢 אין חריגות מאומתות";

  if (rangeAlertCount != null && rangeAlertCount > 0) {
    tone = "critical";
    label = `🔴 ${rangeAlertCount} שבועות לבדיקה בטווח`;
  } else if (verified > 0) {
    tone = "critical";
    label = `🔴 ${verified} חריגות מאומתות`;
  } else if (pending > 0) {
    tone = "warn";
    label = `🟡 ${pending} בדיקות ממתינות לאימות`;
  } else if (status?.status === "warn") {
    tone = "warn";
    label = `🟡 ${status.label}`;
  }

  return (
    <button
      type="button"
      className={`cfc-status-badge cfc-status-badge--${tone}`}
      onClick={onClick}
      title="לחצו לפירוט פערים והתחייבויות"
    >
      {label}
    </button>
  );
}

export default FlowWeekStatusBadge;
