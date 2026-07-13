"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { goToNextWeek, goToPrevWeek, parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { formatAhWeekLabel } from "@/lib/weeks/ah-week";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { getFlowWeeksOverviewAction } from "@/app/admin/cash-flow/get-flow-weeks-overview-action";
import { getFlowWeekDrillAction } from "@/app/admin/cash-flow/get-flow-week-drill-action";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { FlowWeekTablesSection } from "@/components/admin/flow-control/tables/FlowWeekTablesSection";
import { FlowWeekHistorySection } from "@/components/admin/flow-control/dashboard/FlowWeekHistorySection";

const WEEKS_IN_TABLE = 12;

function buildWeekOptions(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - 52 && n >= 1; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}

function buildRecentWeekList(): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 127;
  const out: string[] = [];
  for (let n = active; n > active - WEEKS_IN_TABLE && n >= 1; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}

/** שבועות לטבלת הסיכום — 12 אחרונים + השבוע הנבחר אם מחוץ לטווח */
function overviewWeekCodes(selectedWeek: string): string[] {
  const recent = buildRecentWeekList();
  if (recent.includes(selectedWeek)) return recent;
  return [selectedWeek, ...recent];
}

export function FlowControlClient({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const weekOptions = useMemo(buildWeekOptions, []);
  const [selectedWeek, setSelectedWeek] = useState(
    () => initialWeek?.trim() || weekOptions[0] || ACTIVE_WORK_WEEK_CODE,
  );
  const drillRef = useRef<HTMLDivElement>(null);

  const overviewWeeks = useMemo(() => overviewWeekCodes(selectedWeek), [selectedWeek]);
  const [overview, setOverview] = useState<FlowWeekOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const [drill, setDrill] = useState<FlowWeekDrillPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getFlowWeeksOverviewAction(overviewWeeks).then((data) => {
      if (cancelled) return;
      setOverview(data.weeks);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [overviewWeeks, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    setDrillLoading(true);
    void getFlowWeekDrillAction(selectedWeek).then((data) => {
      if (cancelled) return;
      setDrill(data);
      setDrillLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedWeek, refreshTick]);

  useEffect(() => {
    const onCashControlSaved = (e: Event) => {
      const detail = (e as CustomEvent<CashControlRefreshDetail>).detail;
      if (detail?.weekCode?.trim()) refresh();
    };
    window.addEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
    return () => window.removeEventListener(WEGO_CASH_CONTROL_REFRESH_EVENT, onCashControlSaved);
  }, [refresh]);

  const selectWeek = useCallback((week: string) => {
    const wk = week.trim();
    if (!wk) return;
    setSelectedWeek((prev) => {
      if (prev === wk) return prev;
      window.requestAnimationFrame(() => {
        drillRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return wk;
    });
  }, []);

  const selectedWeekLabel = useMemo(() => formatAhWeekLabel(selectedWeek), [selectedWeek]);
  const canEditManagerCount = caps.canCountEdit || caps.canCountCreate || caps.canManageFlow;

  async function exportFile(format: "pdf" | "excel") {
    const wk = selectedWeek;
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
            <span>
              {selectedWeekLabel ?? selectedWeek} · בקרת תזרים שבועית
            </span>
          </div>
        </div>
        <div className="fc-toolbar__actions">
          <div className="fc-week-nav">
            <button
              type="button"
              className="fc-btn fc-btn--icon"
              aria-label="שבוע קודם"
              onClick={() => {
                const prev = goToPrevWeek(selectedWeek);
                if (prev) selectWeek(prev);
              }}
            >
              <ChevronRight size={18} />
            </button>
            <select
              className="fc-week-select"
              value={selectedWeek}
              onChange={(e) => selectWeek(e.target.value)}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="fc-btn fc-btn--icon"
              aria-label="שבוע הבא"
              onClick={() => {
                const next = goToNextWeek(selectedWeek);
                if (next) selectWeek(next);
              }}
            >
              <ChevronLeft size={18} />
            </button>
          </div>
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
            }}
            aria-label="רענון"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <div ref={drillRef} className="ft-page-body">
        <FlowWeekTablesSection
          drill={drill}
          loading={drillLoading}
          canEditManagerCount={canEditManagerCount}
          onManagerCountSaved={refresh}
        />

        <FlowWeekHistorySection
          rows={overview}
          loading={loading}
          selectedWeek={selectedWeek}
          onSelectWeek={selectWeek}
        />
      </div>
    </div>
  );
}

export default FlowControlClient;
