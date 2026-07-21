"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calculator,
  ChevronDown,
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
import { CashflowRangeSummary } from "@/components/admin/cashflow-control/CashflowRangeSummary";
import { ExchangeProfitLossChart } from "@/components/admin/flow-control/ExchangeProfitLossChart";
import { ExchangeProfitLossHistoryTable } from "@/components/admin/flow-control/ExchangeProfitLossHistoryTable";
import { ExchangeProfitModal } from "@/components/admin/flow-control/exchange-profit/ExchangeProfitModal";
import type { ExchangeProfitPeriodFilter } from "@/app/admin/cash-flow/exchange-profit-types";
import { FlowWeekTablesSection } from "@/components/admin/flow-control/tables/FlowWeekTablesSection";
import { FlowWeekStatusBadge } from "@/components/admin/flow-control/dashboard/FlowWeekStatusBadge";
import {
  aggregateOverviewRange,
  filterWeeksByRange,
  filterWeeksByYear,
  uniqueYears,
  weekCodesInRange,
  weekDateRange,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import "@/components/admin/cashflow-control/cashflow-control.css";
import { ManagerCountWizard } from "@/components/admin/manager-count/ManagerCountWizard";
import {
  TableFiltersBar,
  useTableFilters,
  type TableFilterFieldConfig,
} from "@/components/admin/filters";

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

/** אפשרויות בחירה — מהשבוע הפעיל אחורה */
function buildWeekSelectOptions(activeCode: string, loaded: string[]): string[] {
  const active = parseAhWeekNumber(activeCode) ?? 1;
  const loadedMin = loaded.reduce((min, w) => {
    const n = parseAhWeekNumber(w) ?? active;
    return Math.min(min, n);
  }, active);
  const floor = Math.max(1, Math.min(loadedMin, active - 40));
  const out: string[] = [];
  for (let n = active; n >= floor; n -= 1) out.push(toAhWeekCode(n));
  return out;
}

export function CashflowControlScreen({
  caps,
  initialWeek,
}: {
  caps: CashFlowCapabilities;
  initialWeek: string;
}) {
  const initial = initialWeek?.trim() || ACTIVE_WORK_WEEK_CODE;
  const [selectedWeek, setSelectedWeek] = useState(initial);
  const [overview, setOverview] = useState<FlowWeekOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreWeeks, setHasMoreWeeks] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const {
    values: cfcFilterValues,
    setField: setCfcField,
    clear: clearCfcFilters,
  } = useTableFilters({
    storageKey: "cashflow-control",
    defaults: {
      year: "",
      weekFrom: initial,
      weekTo: initial,
      showEmpty: "1",
    },
  });
  const fromWeek = cfcFilterValues.weekFrom || initial;
  const toWeek = cfcFilterValues.weekTo || initial;
  const yearFilter: number | "all" = cfcFilterValues.year
    ? Number(cfcFilterValues.year)
    : "all";
  const showEmpty = (cfcFilterValues.showEmpty || "1") !== "0";
  const [reportsOpen, setReportsOpen] = useState(false);
  const [varianceOpen, setVarianceOpen] = useState(false);

  const [drill, setDrill] = useState<FlowWeekDrillPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [managerCountOpen, setManagerCountOpen] = useState(false);
  const [profitModalOpen, setProfitModalOpen] = useState(false);
  const [profitPeriodFilter, setProfitPeriodFilter] = useState<ExchangeProfitPeriodFilter | null>(
    null,
  );
  const drillCacheRef = useRef<Map<string, FlowWeekDrillPayload>>(new Map());
  const detailRef = useRef<HTMLDivElement>(null);
  const loadedCodesRef = useRef<string[]>([]);

  const openProfitAll = useCallback(() => {
    setProfitPeriodFilter(null);
    setProfitModalOpen(true);
  }, []);

  const openProfitPeriod = useCallback((filter: ExchangeProfitPeriodFilter) => {
    setProfitPeriodFilter(filter);
    setProfitModalOpen(true);
  }, []);

  const ensureWeeksLoaded = useCallback(async (codes: string[]) => {
    const missing = codes.filter((c) => !loadedCodesRef.current.includes(c));
    if (missing.length === 0) return;
    const data = await getFlowWeeksOverviewAction(missing);
    loadedCodesRef.current = [...loadedCodesRef.current, ...missing];
    setOverview((prev) => mergeWeekRows(prev, data.weeks));
    const oldest = Math.min(
      ...loadedCodesRef.current.map((c) => parseAhWeekNumber(c) ?? 1),
    );
    setHasMoreWeeks(oldest > 1);
  }, []);

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

  // טעינת שבועות חסרים כשמשנים טווח
  useEffect(() => {
    const codes = weekCodesInRange(fromWeek, toWeek);
    if (codes.length === 0) return;
    void ensureWeeksLoaded(codes);
  }, [fromWeek, toWeek, ensureWeeksLoaded]);

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

  useEffect(() => {
    if (overview.length === 0) return;
    if (overview.some((r) => r.week === selectedWeek)) return;
    const inRange = filterWeeksByRange(overview, fromWeek, toWeek);
    setSelectedWeek(inRange[0]?.week ?? overview[0]!.week);
  }, [overview, selectedWeek, fromWeek, toWeek]);

  const years = useMemo(() => uniqueYears(overview), [overview]);
  const weekSelectOptions = useMemo(
    () => buildWeekSelectOptions(
      ACTIVE_WORK_WEEK_CODE,
      overview.map((r) => r.week),
    ),
    [overview],
  );

  const filteredRows = useMemo(() => {
    let rows = filterWeeksByYear(overview, yearFilter);
    rows = filterWeeksByRange(rows, fromWeek, toWeek);
    if (!showEmpty) rows = rows.filter((r) => r.hasData);
    return rows;
  }, [overview, yearFilter, fromWeek, toWeek, showEmpty]);

  const rangeAgg = useMemo(() => aggregateOverviewRange(filteredRows), [filteredRows]);
  const isRange = fromWeek !== toWeek;

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

  const onFromChange = (w: string) => {
    setCfcField("weekFrom", w);
    const fromN = parseAhWeekNumber(w) ?? 1;
    const toN = parseAhWeekNumber(toWeek) ?? fromN;
    if (fromN > toN) setCfcField("weekTo", w);
    const sel = parseAhWeekNumber(selectedWeek) ?? fromN;
    if (sel < fromN || sel > Math.max(fromN, toN)) setSelectedWeek(w);
  };

  const onToChange = (w: string) => {
    setCfcField("weekTo", w);
    const toN = parseAhWeekNumber(w) ?? 1;
    const fromN = parseAhWeekNumber(fromWeek) ?? toN;
    if (toN < fromN) setCfcField("weekFrom", w);
    const sel = parseAhWeekNumber(selectedWeek) ?? toN;
    if (sel < Math.min(fromN, toN) || sel > toN) setSelectedWeek(w);
  };

  const cfcFilterFields = useMemo<TableFilterFieldConfig[]>(
    () => [
      {
        id: "year",
        kind: "select",
        label: "שנה",
        options: years.map((y) => ({ value: String(y), label: String(y) })),
      },
      {
        id: "weekFrom",
        kind: "weekFrom",
        options: weekSelectOptions.map((w) => ({ value: w, label: w })),
      },
      {
        id: "weekTo",
        kind: "weekTo",
        options: weekSelectOptions.map((w) => ({ value: w, label: w })),
      },
      {
        id: "showEmpty",
        kind: "select",
        label: "שבועות ריקים",
        hideEmptyOption: true,
        options: [
          { value: "1", label: "הצג הכל" },
          { value: "0", label: "הסתר ריקים" },
        ],
      },
    ],
    [years, weekSelectOptions],
  );

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
              {isRange && rangeAgg
                ? `${rangeAgg.fromWeek} → ${rangeAgg.toWeek} · ${rangeAgg.weekCount} שבועות`
                : selectedRow
                  ? `${selectedRow.week} · ${weekDateRange(selectedRow.week, selectedRow.weekLabel)}`
                  : "סגירה שבועית"}
            </p>
          </div>
          <FlowWeekStatusBadge
            drill={drill}
            rangeAlertCount={isRange ? rangeAgg?.alertWeekCount ?? 0 : null}
            onClick={() => setVarianceOpen(true)}
          />
        </div>

        <div className="cfc-header__actions">

          <button
            type="button"
            className="cfc-btn cfc-btn--ghost"
            onClick={() => setManagerCountOpen(true)}
          >
            <Calculator size={15} />
            ספירת מנהל
          </button>

          <button type="button" className="cfc-btn cfc-btn--ghost" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
            רענון
          </button>
        </div>
      </header>

      <TableFiltersBar
        fields={cfcFilterFields}
        values={cfcFilterValues}
        onChange={(id, value) => {
          if (id === "weekFrom") onFromChange(value);
          else if (id === "weekTo") onToChange(value);
          else setCfcField(id, value);
        }}
        onClear={() => {
          clearCfcFilters();
          setSelectedWeek(initial);
        }}
        onRefresh={refresh}
        refreshing={loading}
        onExcel={caps.canExport ? () => void exportFile("excel") : undefined}
        onPdf={caps.canExport ? () => void exportFile("pdf") : undefined}
        exporting={!!exporting}
        resultCount={filteredRows.length}
      />

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
        {selectedRow && rangeAgg ? (
          <>
            <CashflowRangeSummary
              agg={rangeAgg}
              focusWeek={selectedWeek}
              weekRows={filteredRows}
            />

            <FlowWeekTablesSection
              drill={drill}
              loading={drillLoading}
              varianceOpenExternal={varianceOpen}
              onVarianceOpenChange={setVarianceOpen}
            />

            <details
              className="cfc-reports-acc"
              open={reportsOpen}
              onToggle={(e) => setReportsOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cfc-reports-acc__summary">
                <ChevronDown size={18} className="cfc-reports-acc__chevron" aria-hidden />
                <span>דוחות וגרפים</span>
                <span className="cfc-reports-acc__hint">כרטיסי סיכום · גרף רווח</span>
              </summary>
              <div className="cfc-reports-acc__body">
                <CashflowWeekCards
                  row={selectedRow}
                  drill={drill}
                  loading={drillLoading}
                  onProfitClick={openProfitAll}
                />
                {drill?.flow?.fxProfitLoss ? (
                  <div className="cfc-fx-panel">
                    <ExchangeProfitLossChart
                      summary={drill.flow.fxProfitLoss}
                      history={drill.flow.fxProfitLossHistory ?? []}
                      onOpenProfitDetail={openProfitAll}
                      onOpenPeriod={openProfitPeriod}
                    />
                    <ExchangeProfitLossHistoryTable rows={drill.flow.fxProfitLossHistory ?? []} />
                  </div>
                ) : null}
              </div>
            </details>
          </>
        ) : (
          <div className="cfc-card">
            <p className="cfc-empty">בחרו שבוע או טווח שבועות להצגת הסיכום</p>
          </div>
        )}
      </div>
      <ManagerCountWizard
        open={managerCountOpen}
        week={selectedWeek}
        weekLabel={selectedRow?.weekLabel ?? null}
        flow={drill?.flow ?? null}
        overview={overview}
        canEdit={caps.canManageFlow || caps.canCountEdit}
        onClose={() => setManagerCountOpen(false)}
        onSaved={() => {
          setManagerCountOpen(false);
          refresh();
        }}
      />
      <ExchangeProfitModal
        open={profitModalOpen}
        week={selectedWeek}
        periodFilter={profitPeriodFilter}
        onClose={() => {
          setProfitModalOpen(false);
          setProfitPeriodFilter(null);
        }}
      />
    </div>
  );
}

export default CashflowControlScreen;
