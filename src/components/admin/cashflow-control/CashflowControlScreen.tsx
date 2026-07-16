"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
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
import { CashflowWeeksTable } from "@/components/admin/cashflow-control/CashflowWeeksTable";
import { CashflowWeekCards } from "@/components/admin/cashflow-control/CashflowWeekCards";
import { CashflowWeekTabs } from "@/components/admin/cashflow-control/CashflowWeekTabs";
import {
  filterWeeksByYear,
  uniqueYears,
  weekDateRange,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import "@/components/admin/cashflow-control/cashflow-control.css";

/** טעינה ראשונית — 3 שבועות אחרונים בלבד */
const INITIAL_WEEKS = 3;
/** בכל «טען נוספים» — עוד 5 שבועות ישנים יותר */
const LOAD_MORE_BATCH = 5;

function weekCodesFromActive(count: number, oldestAlreadyLoaded?: number | null): string[] {
  const active = parseAhWeekNumber(ACTIVE_WORK_WEEK_CODE) ?? 1;
  const start = oldestAlreadyLoaded != null ? oldestAlreadyLoaded - 1 : active;
  const out: string[] = [];
  for (let n = start; n >= 1 && out.length < count; n -= 1) {
    out.push(toAhWeekCode(n));
  }
  return out;
}

function mergeWeekRows(prev: FlowWeekOverviewRow[], next: FlowWeekOverviewRow[]): FlowWeekOverviewRow[] {
  const map = new Map<string, FlowWeekOverviewRow>();
  for (const r of prev) map.set(r.week, r);
  for (const r of next) map.set(r.week, r);
  return [...map.values()].sort((a, b) => (parseAhWeekNumber(b.week) ?? 0) - (parseAhWeekNumber(a.week) ?? 0));
}

export function CashflowControlScreen({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const [selectedWeek, setSelectedWeek] = useState(
    () => initialWeek?.trim() || ACTIVE_WORK_WEEK_CODE,
  );
  const [overview, setOverview] = useState<FlowWeekOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreWeeks, setHasMoreWeeks] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [showEmpty, setShowEmpty] = useState(true);

  const [drill, setDrill] = useState<FlowWeekDrillPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const drillCacheRef = useRef<Map<string, FlowWeekDrillPayload>>(new Map());
  const detailRef = useRef<HTMLDivElement>(null);
  const loadedCodesRef = useRef<string[]>([]);

  const refreshVisible = useCallback(async () => {
    const codes =
      loadedCodesRef.current.length > 0
        ? loadedCodesRef.current
        : weekCodesFromActive(INITIAL_WEEKS);
    setLoading(true);
    const data = await getFlowWeeksOverviewAction(codes);
    loadedCodesRef.current = codes;
    setOverview(data.weeks);
    const oldest = parseAhWeekNumber(codes[codes.length - 1] ?? "") ?? 1;
    setHasMoreWeeks(oldest > 1);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    drillCacheRef.current.clear();
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // רענון: טוען מחדש רק את השבועות שכבר נטענו (לא כל ההיסטוריה)
      if (loadedCodesRef.current.length === 0) {
        const codes = weekCodesFromActive(INITIAL_WEEKS);
        setLoading(true);
        const data = await getFlowWeeksOverviewAction(codes);
        if (cancelled) return;
        loadedCodesRef.current = codes;
        setOverview(data.weeks);
        const oldest = parseAhWeekNumber(codes[codes.length - 1] ?? "") ?? 1;
        setHasMoreWeeks(oldest > 1);
        setLoading(false);
        return;
      }
      if (cancelled) return;
      await refreshVisible();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, refreshVisible]);

  const loadMoreWeeks = useCallback(async () => {
    if (loadingMore || !hasMoreWeeks) return;
    const current = loadedCodesRef.current;
    const oldest = parseAhWeekNumber(current[current.length - 1] ?? "") ?? 1;
    if (oldest <= 1) {
      setHasMoreWeeks(false);
      return;
    }
    const nextCodes = weekCodesFromActive(LOAD_MORE_BATCH, oldest);
    if (nextCodes.length === 0) {
      setHasMoreWeeks(false);
      return;
    }
    setLoadingMore(true);
    try {
      const data = await getFlowWeeksOverviewAction(nextCodes);
      loadedCodesRef.current = [...current, ...nextCodes];
      setOverview((prev) => mergeWeekRows(prev, data.weeks));
      const newOldest = parseAhWeekNumber(nextCodes[nextCodes.length - 1] ?? "") ?? 1;
      setHasMoreWeeks(newOldest > 1);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMoreWeeks, loadingMore]);

  useEffect(() => {
    const wk = selectedWeek.trim();
    if (!wk) return;
    const cached = drillCacheRef.current.get(wk);
    if (cached) {
      setDrill(cached);
      setDrillLoading(false);
      return;
    }
    let cancelled = false;
    setDrillLoading(true);
    void getFlowWeekDrillAction(wk).then((data) => {
      if (cancelled) return;
      if (data) drillCacheRef.current.set(wk, data);
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

  // אם השבוע הנבחר לא בטעינה הנוכחית — בחר את העדכני ביותר שנטען
  useEffect(() => {
    if (overview.length === 0) return;
    if (overview.some((r) => r.week === selectedWeek)) return;
    setSelectedWeek(overview[0]!.week);
  }, [overview, selectedWeek]);

  const years = useMemo(() => uniqueYears(overview), [overview]);
  const loadedWeekOptions = useMemo(
    () => overview.map((r) => r.week).sort((a, b) => (parseAhWeekNumber(b) ?? 0) - (parseAhWeekNumber(a) ?? 0)),
    [overview],
  );

  const filteredRows = useMemo(() => {
    let rows = filterWeeksByYear(overview, yearFilter);
    if (weekFilter !== "all") rows = rows.filter((r) => r.week === weekFilter);
    if (!showEmpty) rows = rows.filter((r) => r.hasData);
    return rows;
  }, [overview, yearFilter, weekFilter, showEmpty]);

  const selectedRow = useMemo(
    () => overview.find((r) => r.week === selectedWeek) ?? filteredRows[0] ?? null,
    [overview, filteredRows, selectedWeek],
  );

  const selectWeek = useCallback((week: string) => {
    const wk = week.trim();
    if (!wk) return;
    setSelectedWeek(wk);
    window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

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
    <div className="cfc-page" dir="rtl">
      <header className="cfc-header">
        <div className="cfc-header__title">
          <div className="cfc-header__icon">
            <TrendingUp size={20} />
          </div>
          <div>
            <h1>בקרת תזרים</h1>
            <p>
              {selectedRow
                ? `${selectedRow.week} · ${weekDateRange(selectedRow.week, selectedRow.weekLabel)}`
                : "סגירה שבועית · 3 שבועות אחרונים"}
            </p>
          </div>
        </div>

        <div className="cfc-header__actions">
          <label className="cfc-select">
            <span>שנה</span>
            <select
              value={yearFilter === "all" ? "all" : String(yearFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setYearFilter(v === "all" ? "all" : Number(v));
              }}
            >
              <option value="all">הכל</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label className="cfc-select">
            <span>שבוע</span>
            <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)}>
              <option value="all">כל הנטענים</option>
              {loadedWeekOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`cfc-btn cfc-btn--ghost${showEmpty ? "" : " is-active"}`}
            onClick={() => setShowEmpty((v) => !v)}
            title="סינון שבועות ללא נתונים"
          >
            <Filter size={15} />
            סינון
          </button>

          {caps.canExport ? (
            <>
              <button
                type="button"
                className="cfc-btn cfc-btn--ghost"
                disabled={!!exporting}
                onClick={() => void exportFile("pdf")}
              >
                <FileText size={15} /> PDF
              </button>
              <button
                type="button"
                className="cfc-btn cfc-btn--ghost"
                disabled={!!exporting}
                onClick={() => void exportFile("excel")}
              >
                <FileSpreadsheet size={15} /> Excel
              </button>
            </>
          ) : null}

          <button type="button" className="cfc-btn cfc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
            רענון
          </button>
        </div>
      </header>

      <CashflowWeeksTable
        rows={filteredRows}
        loading={loading}
        selectedWeek={selectedWeek}
        onSelectWeek={selectWeek}
        hasMore={hasMoreWeeks}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMoreWeeks()}
      />

      <div ref={detailRef} className="cfc-detail">
        {selectedRow ? (
          <>
            <div className="cfc-detail__head">
              <h2>
                סיכום שבוע <span dir="ltr">{selectedRow.week}</span>
              </h2>
              <span>{weekDateRange(selectedRow.week, selectedRow.weekLabel)}</span>
            </div>
            <CashflowWeekCards row={selectedRow} drill={drill} loading={drillLoading} />
            <CashflowWeekTabs
              row={selectedRow}
              drill={drill}
              loading={drillLoading}
              canManageFlow={caps.canManageFlow || caps.canCountEdit}
              onFxSaved={refresh}
            />
          </>
        ) : (
          <div className="cfc-card">
            <p className="cfc-empty">בחרו שבוע מהטבלה להצגת הסיכום</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CashflowControlScreen;
