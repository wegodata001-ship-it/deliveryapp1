"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getCashFlowCapabilitiesAction } from "@/app/admin/cash-flow/actions";
import { getAllFlowWeeksOverviewAction } from "@/app/admin/cash-flow/get-all-flow-weeks-overview-action";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { FlowWeeksOverviewBlocks } from "@/components/admin/flow-control/FlowWeeksOverviewBlocks";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";

const DEFAULT_CAPS: CashFlowCapabilities = {
  canView: false,
  canCountCreate: false,
  canCountEdit: false,
  canCountApprove: false,
  canExpenseCreate: false,
  canExpenseEdit: false,
  canExpenseDelete: false,
  canExport: false,
  canManageFlow: false,
};

export function CashFlowSourceTableClient() {
  const [caps, setCaps] = useState<CashFlowCapabilities>(DEFAULT_CAPS);
  const [overview, setOverview] = useState<FlowWeekOverviewRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const [selectedWeek, setSelectedWeek] = useState<string>(ACTIVE_WORK_WEEK_CODE);
  const tableRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  // טעינת הרשאות
  useEffect(() => {
    void getCashFlowCapabilitiesAction().then((c) => setCaps(c ?? DEFAULT_CAPS));
  }, []);

  // טעינת כל השבועות
  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    void getAllFlowWeeksOverviewAction().then((data) => {
      if (cancelled) return;
      setOverview(data.weeks);
      setOverviewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // האזנה לאירועי רענון (כגון שמירת קליטת תשלום)
  useEffect(() => {
    const onRefresh = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      if (detail?.weekCode?.trim()) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onRefresh);
  }, [refresh]);

  void caps;

  const handleSelectWeek = useCallback((week: string) => {
    const wk = week.trim();
    if (!wk) return;
    setSelectedWeek(wk);
    window.requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="fc-page">
      {/* כותרת ופקד רענון */}
      <div className="adm-source-pro__toolbar" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="fc-btn fc-btn--ghost"
          onClick={refresh}
          aria-label="רענון"
        >
          <RefreshCw size={15} />
          <span>רענון</span>
        </button>
      </div>

      {/* טבלה 1 — סיכום כל השבועות */}
      <section className="ft-section" aria-label="סיכום שבועות">
        <h2 className="ft-section-title">כל השבועות</h2>
        <FlowWeeksOverviewBlocks
          rows={overview}
          loading={overviewLoading}
          selectedWeek={selectedWeek}
          onSelectWeek={handleSelectWeek}
        />
      </section>
      <div ref={tableRef} />
    </div>
  );
}
