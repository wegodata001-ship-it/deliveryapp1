"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { summarizeFlowControlStatus } from "@/lib/flow-control/flow-control-status";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";
import { deriveWeekStatus } from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";

export function FlowWeekStatusBanner({ drill }: { drill: FlowWeekDrillPayload }) {
  const summary = summarizeFlowControlStatus(getFlowWeekVarianceLines(drill));
  const fallback = deriveWeekStatus(drill);
  const financial = summary.financialCount > 0;
  const waiting = !financial && summary.waitingCount > 0;
  const tone = financial ? "critical" : waiting ? "warn" : fallback.status;
  const label = financial || waiting ? summary.label : fallback.label;
  const dot = financial ? "🔴" : waiting ? "🟡" : fallback.dot;

  return (
    <div className={`fd-status-banner fd-status-banner--${tone}`} role="status">
      <span className="fd-status-banner__dot" aria-hidden>
        {dot}
      </span>
      <div>
        <strong>{label}</strong>
        <span className="fd-status-banner__sub">{drill.weekLabel ?? drill.week}</span>
      </div>
    </div>
  );
}

export default FlowWeekStatusBanner;
