"use client";

import { ChevronLeft } from "lucide-react";
import type { FlowWeekUiStatus } from "@/components/admin/flow-control/dashboard/flow-dashboard-derive";

export type FlowDashboardTileProps = {
  title: string;
  value: string;
  statusLabel?: string;
  status?: FlowWeekUiStatus;
  accent: "blue" | "green" | "purple" | "orange" | "teal" | "gray";
  onClick: () => void;
};

const STATUS_TEXT: Record<FlowWeekUiStatus, string> = {
  ok: "תקין",
  warn: "לתשומת לב",
  critical: "חריגה",
};

export function FlowDashboardTile({
  title,
  value,
  statusLabel,
  status = "ok",
  accent,
  onClick,
}: FlowDashboardTileProps) {
  return (
    <button type="button" className={`fd-tile fd-tile--${accent}`} onClick={onClick}>
      <div className={`fd-tile__head fd-tile__head--${accent}`}>{title}</div>
      <div className="fd-tile__body">
        <strong dir="ltr" className="fd-tile__value">
          {value}
        </strong>
        <span className={`fd-tile__status fd-tile__status--${status}`}>
          {statusLabel ?? STATUS_TEXT[status]}
        </span>
      </div>
      <ChevronLeft size={16} className="fd-tile__chev" aria-hidden />
    </button>
  );
}

export default FlowDashboardTile;
