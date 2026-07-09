"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { getFlowWeeksOverviewAction } from "@/app/admin/cash-flow/get-flow-weeks-overview-action";
import { getFlowWeekDrillAction } from "@/app/admin/cash-flow/get-flow-week-drill-action";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { FlowWeeksOverviewTable } from "@/components/admin/flow-control/FlowWeeksOverviewTable";
import { FlowWeekDrillPanel } from "@/components/admin/flow-control/FlowWeekDrillPanel";

const WEEKS_TO_SHOW = 12;

function buildWeekList(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - WEEKS_TO_SHOW && n >= 1; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}

export function FlowControlClient({
  caps,
  initialWeek: _initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const weekList = useMemo(buildWeekList, []);
  const [overview, setOverview] = useState<FlowWeekOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);
  const [drill, setDrill] = useState<FlowWeekDrillPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  const loadDrill = useCallback(async (week: string) => {
    setDrillLoading(true);
    try {
      const data = await getFlowWeekDrillAction(week);
      setDrill(data);
    } finally {
      setDrillLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getFlowWeeksOverviewAction(weekList).then((data) => {
      if (cancelled) return;
      setOverview(data.weeks);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [weekList, refreshTick]);

  useEffect(() => {
    const onCashControlSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      if (detail?.weekCode?.trim()) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
  }, [refresh]);

  const toggleWeek = useCallback(
    async (week: string) => {
      if (expandedWeek === week) {
        setExpandedWeek(null);
        setDrill(null);
        return;
      }
      setExpandedWeek(week);
      setDrill(null);
      await loadDrill(week);
    },
    [expandedWeek, loadDrill],
  );

  async function exportFile(format: "pdf" | "excel") {
    const wk = expandedWeek ?? weekList[0];
    if (!wk) return;
    setExporting(format);
    try {
      const endpoint =
        format === "excel"
          ? "/api/controls/cash-control/export/excel"
          : "/api/controls/cash-control/export/pdf";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: wk }),
      });
      if (!res.ok) {
        alert((await res.json().then((b) => b?.error).catch(() => null)) ?? "ייצוא נכשל");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") window.open(url, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Flow_Control_${wk}.xlsx`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="fc-page">
      <header className="fc-toolbar">
        <div className="fc-toolbar__brand">
          <TrendingUp size={22} />
          <div>
            <h1>בקרת תזרים</h1>
            <span>סיכום שבועי — מבקרת קופה</span>
          </div>
        </div>
        <div className="fc-toolbar__actions">
          {caps.canExport ? (
            <>
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                disabled={!!exporting}
                onClick={() => void exportFile("excel")}
              >
                <FileSpreadsheet size={15} /> Excel
              </button>
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                disabled={!!exporting}
                onClick={() => void exportFile("pdf")}
              >
                <FileText size={15} /> PDF
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="fc-btn fc-btn--ghost"
            onClick={() => {
              refresh();
              if (expandedWeek) void loadDrill(expandedWeek);
            }}
            aria-label="רענון"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <section className="fc-section fc-section--blue">
        <header className="fc-section__head">
          <div>
            <h2>סיכום שבועי</h2>
            <p className="fc-section__sub">כל שורה = שבוע אחד · לחץ לפירוט</p>
          </div>
        </header>
        <FlowWeeksOverviewTable
          rows={overview}
          loading={loading}
          expandedWeek={expandedWeek}
          onToggleWeek={(w) => void toggleWeek(w)}
        />
      </section>

      {expandedWeek ? (
        <FlowWeekDrillPanel drill={drill} loading={drillLoading} />
      ) : (
        <p className="fc-hint">בחר שבוע מהטבלה לצפייה בפירוט מלא</p>
      )}
    </div>
  );
}

export default FlowControlClient;
