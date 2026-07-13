"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, History } from "lucide-react";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { FlowWeeksOverviewTable } from "@/components/admin/flow-control/FlowWeeksOverviewTable";

export type FlowWeekHistorySectionProps = {
  rows: FlowWeekOverviewRow[];
  loading: boolean;
  selectedWeek: string;
  onSelectWeek: (week: string) => void;
  onFxProfitClick?: (week: string) => void;
};

export function FlowWeekHistorySection({
  rows,
  loading,
  selectedWeek,
  onSelectWeek,
  onFxProfitClick,
}: FlowWeekHistorySectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="fd-history">
      <button type="button" className="fd-history__toggle" onClick={() => setOpen((v) => !v)}>
        <History size={16} />
        <span>השוואת שבועות</span>
        {open ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
      </button>
      <div className={`fd-history__panel${open ? " is-open" : ""}`}>
        {open ? (
          <FlowWeeksOverviewTable
            rows={rows}
            loading={loading}
            selectedWeek={selectedWeek}
            onSelectWeek={onSelectWeek}
            onFxProfitClick={onFxProfitClick}
          />
        ) : null}
      </div>
    </section>
  );
}

export default FlowWeekHistorySection;
