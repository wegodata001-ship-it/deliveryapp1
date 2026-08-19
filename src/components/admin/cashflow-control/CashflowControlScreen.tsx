"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, RefreshCw, TrendingUp } from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { CurrentBalancesKpiStrip } from "@/components/admin/cashflow-control/CurrentBalancesKpiStrip";
import { parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { getCashflowControlBootstrapAction } from "@/app/admin/cash-flow/get-cashflow-control-bootstrap-action";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { CashflowWeeksTable } from "@/components/admin/cashflow-control/CashflowWeeksTable";
import { CashflowRangeSummary } from "@/components/admin/cashflow-control/CashflowRangeSummary";
import { FlowWeekTablesSection } from "@/components/admin/flow-control/tables/FlowWeekTablesSection";
import { FlowWeekStatusBadge } from "@/components/admin/flow-control/dashboard/FlowWeekStatusBadge";
import {
  aggregateOverviewRange,
  dedupeOverviewByWeek,
  dedupeWeekCodes,
  filterWeeksByRange,
  filterWeeksByYear,
  uniqueYears,
  weekCodesInRange,
  weekDateRange,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import "@/components/admin/cashflow-control/cashflow-control.css";
import { WeekMovementJournal } from "@/components/admin/cashflow-control/WeekMovementJournal";
import { CashflowFxTrackCards } from "@/components/admin/cashflow-control/CashflowFxTrackCards";
import {
  CashflowKpiDrillModal,
  type CashflowKpiUiKind,
} from "@/components/admin/cashflow-control/CashflowKpiDrillModal";
import { buildWeekMovementJournal } from "@/lib/flow-control/services/week-movement-journal.shared";
import { ManagerCountWizard } from "@/components/admin/manager-count/ManagerCountWizard";
import { money } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { WEGO_COUNTRY_CHANGED } from "@/lib/country-switch-bus";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";
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
  return dedupeOverviewByWeek([...prev, ...next]);
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
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
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
  const [varianceOpen, setVarianceOpen] = useState(false);
  const [fxDrillKind, setFxDrillKind] = useState<CashflowKpiUiKind | null>(null);

  const [drill, setDrill] = useState<FlowWeekDrillPayload | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [managerCountOpen, setManagerCountOpen] = useState(false);
  const drillCacheRef = useRef<Map<string, FlowWeekDrillPayload>>(new Map());
  const detailRef = useRef<HTMLDivElement>(null);
  const loadedCodesRef = useRef<string[]>([]);

  const ensureWeeksLoaded = useCallback(async (codes: string[]) => {
    const missing = codes.filter((c) => !loadedCodesRef.current.includes(c));
    if (missing.length === 0) return;
    const data = await getCashflowControlBootstrapAction({
      overviewWeeks: missing,
      selectedWeek: "",
      workCountry,
      includeBalances: false,
    });
    loadedCodesRef.current = dedupeWeekCodes([...loadedCodesRef.current, ...missing]);
    setOverview((prev) => mergeWeekRows(prev, data.overviewWeeks));
    const oldest = Math.min(
      ...loadedCodesRef.current.map((c) => parseAhWeekNumber(c) ?? 1),
    );
    setHasMoreWeeks(oldest > 1);
  }, [workCountry]);

  const loadBootstrap = useCallback(
    async (overviewCodes: string[], drillWeek: string) => {
      setLoading(true);
      setDrillLoading(true);
      setDrillError(null);
      try {
        const data = await getCashflowControlBootstrapAction({
          overviewWeeks: overviewCodes,
          selectedWeek: drillWeek,
          workCountry,
          includeBalances: false,
        });
        loadedCodesRef.current = dedupeWeekCodes(overviewCodes);
        setOverview(dedupeOverviewByWeek(data.overviewWeeks));
        const oldest = parseAhWeekNumber(overviewCodes[overviewCodes.length - 1] ?? "") ?? 1;
        setHasMoreWeeks(oldest > 1);
        if (data.drill) {
          drillCacheRef.current.set(drillWeek, data.drill);
          setDrill(data.drill);
        } else {
          setDrill(null);
          setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
        }
      } catch {
        setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
      } finally {
        setLoading(false);
        setDrillLoading(false);
      }
    },
    [workCountry],
  );

  const loadDrillOnly = useCallback(
    async (wk: string) => {
      const cached = drillCacheRef.current.get(wk);
      if (cached) {
        setDrill(cached);
        setDrillLoading(false);
        setDrillError(null);
        return;
      }
      setDrillLoading(true);
      setDrillError(null);
      try {
        const data = await getCashflowControlBootstrapAction({
          overviewWeeks: [],
          selectedWeek: wk,
          workCountry,
          includeBalances: false,
        });
        if (data.drill) {
          drillCacheRef.current.set(wk, data.drill);
          setDrill(data.drill);
        } else {
          setDrill(null);
          setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
        }
      } catch {
        setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
      } finally {
        setDrillLoading(false);
      }
    },
    [workCountry],
  );

  const refreshVisible = useCallback(async () => {
    const codes = dedupeWeekCodes(
      loadedCodesRef.current.length > 0
        ? loadedCodesRef.current
        : weekCodesFromActive(INITIAL_WEEKS),
    );
    await loadBootstrap(codes, selectedWeek.trim() || initial);
  }, [initial, loadBootstrap, selectedWeek]);

  const refresh = useCallback(() => {
    drillCacheRef.current.clear();
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (loadedCodesRef.current.length === 0) {
        const codes = weekCodesFromActive(INITIAL_WEEKS);
        const drillWeek = initial;
        if (cancelled) return;
        await loadBootstrap(codes, drillWeek);
        return;
      }
      if (cancelled) return;
      await refreshVisible();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick, refreshVisible, loadBootstrap, initial]);

  // טעינת שבועות חסרים כשמשנים טווח — רק אחרי טעינה ראשונית
  useEffect(() => {
    if (loading) return;
    const codes = weekCodesInRange(fromWeek, toWeek);
    const missing = codes.filter((c) => !loadedCodesRef.current.includes(c));
    if (missing.length === 0) return;
    void ensureWeeksLoaded(missing);
  }, [fromWeek, toWeek, loading, ensureWeeksLoaded]);

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
      const data = await getCashflowControlBootstrapAction({
        overviewWeeks: nextCodes,
        selectedWeek: "",
        workCountry,
        includeBalances: false,
      });
      loadedCodesRef.current = dedupeWeekCodes([...current, ...nextCodes]);
      setOverview((prev) => mergeWeekRows(prev, data.overviewWeeks));
      const newOldest = parseAhWeekNumber(nextCodes[nextCodes.length - 1] ?? "") ?? 1;
      setHasMoreWeeks(newOldest > 1);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMoreWeeks, loadingMore, workCountry]);

  useEffect(() => {
    const wk = selectedWeek.trim();
    if (!wk || loading) return;
    const cached = drillCacheRef.current.get(wk);
    if (cached) {
      setDrill(cached);
      setDrillLoading(false);
      setDrillError(null);
      return;
    }
    void loadDrillOnly(wk);
  }, [selectedWeek, refreshTick, loading, loadDrillOnly]);

  useEffect(() => {
    const onCountryChanged = () => {
      loadedCodesRef.current = [];
      setOverview([]);
      drillCacheRef.current.clear();
      setDrill(null);
      refresh();
    };
    window.addEventListener(WEGO_COUNTRY_CHANGED, onCountryChanged);
    return () => window.removeEventListener(WEGO_COUNTRY_CHANGED, onCountryChanged);
  }, [refresh]);

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
    return dedupeOverviewByWeek(rows);
  }, [overview, yearFilter, fromWeek, toWeek, showEmpty]);

  const rangeAgg = useMemo(() => aggregateOverviewRange(filteredRows), [filteredRows]);
  const isRange = fromWeek !== toWeek;

  const selectedRow = useMemo(
    () => overview.find((r) => r.week === selectedWeek) ?? filteredRows[0] ?? null,
    [overview, filteredRows, selectedWeek],
  );

  const movementJournal = useMemo(
    () => (drill ? buildWeekMovementJournal(drill) : []),
    [drill],
  );

  const weekStatusCards = useMemo(() => {
    if (!selectedRow) return null;
    const fxPsIls = Number(selectedRow.fxPurchaseIls) || 0;
    const expenses = Number(selectedRow.expensesIls) || 0;
    const outflows = fxPsIls + expenses + (Number(selectedRow.turkeyTransferredUsd) || 0);
    return {
      receipts: Number(selectedRow.totalReceivedIls) || 0,
      outflows,
      netHint: selectedRow.drawerRemainingIls,
    };
  }, [selectedRow]);

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

      <CurrentBalancesKpiStrip
        workCountry={workCountry}
        asOfWeek={selectedWeek}
        refreshKey={refreshTick}
        weekFxPurchases={drill?.flow.fxPurchases}
        weekFxLoading={drillLoading && !drill}
      />

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
              focusRow={selectedRow}
              loading={loading || drillLoading}
            />

            {!isRange ? (
              <CashflowFxTrackCards
                purchases={drill?.flow.fxPurchases}
                weekCode={selectedWeek}
                loading={drillLoading}
                error={drillError}
                onDrillPs={() => setFxDrillKind("fxPs")}
                onDrillIl={() => setFxDrillKind("fxIl")}
                onRetry={() => void loadDrillOnly(selectedWeek.trim())}
              />
            ) : null}

            {!isRange && weekStatusCards ? (
              <section className="cfc-week-status" aria-label="מצב השבוע">
                <header className="cfc-week-status__head">
                  <span className="cfc-flow-step">④</span>
                  <h2>יתרות השבוע · <span dir="ltr">{selectedWeek}</span></h2>
                </header>
                <div className="cfc-week-status__grid">
                  <div className="cfc-week-status__card cfc-week-status__card--in">
                    <span>① סה״כ תקבולים</span>
                    <strong dir="ltr">{money("ILS", weekStatusCards.receipts)}</strong>
                  </div>
                  <div className="cfc-week-status__card cfc-week-status__card--out">
                    <span>③ סה״כ יציאות</span>
                    <strong dir="ltr">{money("ILS", weekStatusCards.outflows)}</strong>
                  </div>
                  <div className="cfc-week-status__card cfc-week-status__card--balance">
                    <span>④ מזומן ₪ בקופה</span>
                    <strong dir="ltr">₪{weekStatusCards.netHint}</strong>
                  </div>
                </div>
              </section>
            ) : null}

            <WeekMovementJournal
              entries={movementJournal}
              weekCode={selectedWeek}
              loading={drillLoading}
              error={drillError}
              onRetry={() => void loadDrillOnly(selectedWeek.trim())}
            />

            <FlowWeekTablesSection
              drill={drill}
              loading={drillLoading}
              error={drillError}
              onRetry={() => void loadDrillOnly(selectedWeek.trim())}
              varianceOpenExternal={varianceOpen}
              onVarianceOpenChange={setVarianceOpen}
            />
          </>
        ) : (
          <div className="cfc-card">
            <p className="cfc-empty">בחרו שבוע או טווח שבועות להצגת הסיכום</p>
          </div>
        )}
      </div>
      <CashflowKpiDrillModal
        open={fxDrillKind != null}
        kind={fxDrillKind}
        weekCodes={[selectedWeek.trim()]}
        weekRows={filteredRows}
        onClose={() => setFxDrillKind(null)}
      />
      <ManagerCountWizard
        open={managerCountOpen}
        week={selectedWeek}
        weekLabel={selectedRow?.weekLabel ?? null}
        flow={drill?.flow ?? null}
        overview={overview}
        canEdit={caps.canManageFlow || caps.canCountEdit}
        onClose={() => setManagerCountOpen(false)}
        onRefresh={() => refresh()}
        onSaved={() => {
          setManagerCountOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

export default CashflowControlScreen;
