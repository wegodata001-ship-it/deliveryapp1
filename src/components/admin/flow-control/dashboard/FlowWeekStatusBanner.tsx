"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { deriveWeekStatus } from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";

export function FlowWeekStatusBanner({ drill }: { drill: FlowWeekDrillPayload }) {
  const s = deriveWeekStatus(drill);
  return (
    <div className={`fd-status-banner fd-status-banner--${s.status}`} role="status">
      <span className="fd-status-banner__dot" aria-hidden>
        {s.dot}
      </span>
      <div>
        <strong>{s.label}</strong>
        <span className="fd-status-banner__sub">
          {drill.weekLabel ?? drill.week}
        </span>
      </div>
    </div>
  );
}

export default FlowWeekStatusBanner;
