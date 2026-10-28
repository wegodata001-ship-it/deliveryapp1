"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Calculator,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from "lucide-react";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { goToNextWeek, goToPrevWeek, parseAhWeekNumber, toAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { CashflowPrimaryKpiStrip } from "@/components/admin/cashflow-control/CashflowPrimaryKpiStrip";
import { CashflowAnomaliesModal } from "@/components/admin/cashflow-control/CashflowAnomaliesModal";
import { CashflowWeekDetailPanel } from "@/components/admin/cashflow-control/CashflowWeekDetailPanel";
import type { CashFlowCapabilities } from "@/app/admin/cash-flow/types";
import type { FlowWeekDrillPayload, FlowWeekOverviewRow } from "@/app/admin/cash-flow/flow-types";
import { getCashflowControlBootstrapAction } from "@/app/admin/cash-flow/get-cashflow-control-bootstrap-action";
import {
  WEGO_CASH_CONTROL_REFRESH_EVENT,
  type CashControlRefreshDetail,
} from "@/lib/cash-control-refresh-bus";
import { CashflowWeeksTable } from "@/components/admin/cashflow-control/CashflowWeeksTable";
import {
  aggregateOverviewRange,
  dedupeOverviewByWeek,
  dedupeWeekCodes,
  expandWeekRangeToInclude,
  filterWeeksByRange,
  filterWeeksByYear,
  isWeekInRange,
  uniqueYears,
  weekCodesInRange,
  weekDateRange,
} from "@/components/admin/cashflow-control/cashflow-control-helpers";
import { countVerifiedFlowExceptions } from "@/lib/flow-control/flow-week-business-reconciliation";
import "@/components/admin/cashflow-control/cashflow-control.css";
import { ManagerCountWizard } from "@/components/admin/manager-count/ManagerCountWizard";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlWeek = searchParams.get("week")?.trim();
  const activeWorkWeek = ACTIVE_WORK_WEEK_CODE;
  const initial = urlWeek || initialWeek?.trim() || activeWorkWeek;
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const [selectedWeek, setSelectedWeek] = useState(initial);
  const userPickedWeekRef = useRef(false);
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
      weekFrom: activeWorkWeek,
      weekTo: activeWorkWeek,
      showEmpty: "1",
    },
  });
  const rangeSyncedRef = useRef(false);
  const fromWeek = cfcFilterValues.weekFrom || initial;
  const toWeek = cfcFilterValues.weekTo || initial;
  const yearFilter: number | "all" = cfcFilterValues.year
    ? Number(cfcFilterValues.year)
    : "all";
  const showEmpty = (cfcFilterValues.showEmpty || "1") !== "0";
  const [anomaliesOpen, setAnomaliesOpen] = useState(false);
  const drillRequestIdRef = useRef(0);

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
      const reqId = ++drillRequestIdRef.current;
      setDrillLoading(true);
      setDrillError(null);
      try {
        const data = await getCashflowControlBootstrapAction({
          overviewWeeks: [],
          selectedWeek: wk,
          workCountry,
          includeBalances: false,
        });
        if (reqId !== drillRequestIdRef.current) return;
        if (data.drill) {
          drillCacheRef.current.set(wk, data.drill);
          setDrill(data.drill);
        } else {
          setDrill(null);
          setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
        }
      } catch {
        if (reqId !== drillRequestIdRef.current) return;
        setDrillError("לא ניתן לטעון את הנתונים — נסה שוב");
      } finally {
        if (reqId === drillRequestIdRef.current) setDrillLoading(false);
      }
    },
    [workCountry],
  );

  const syncWeekToUrl = useCallback(
    (wk: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("week", wk);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
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

  /** selectedDetailWeek חייב להישאר — לא לדרוס לשורה הראשונה בטבלה (תיקון AH-146 מול AH-133) */
  useEffect(() => {
    if (loading || overview.length === 0) return;
    if (overview.some((r) => r.week === selectedWeek.trim())) return;
    void ensureWeeksLoaded([selectedWeek.trim()]);
  }, [overview, selectedWeek, loading, ensureWeeksLoaded]);

  useEffect(() => {
    if (rangeSyncedRef.current) return;
    rangeSyncedRef.current = true;
    const detail = initial.trim();
    if (!isWeekInRange(detail, fromWeek, toWeek)) {
      const expanded = expandWeekRangeToInclude(fromWeek, toWeek, detail);
      setCfcField("weekFrom", expanded.fromWeek);
      setCfcField("weekTo", expanded.toWeek);
    }
  }, [fromWeek, toWeek, initial, setCfcField]);

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
    const detail = selectedWeek.trim();
    if (!showEmpty) {
      rows = rows.filter((r) => r.hasData || r.week === detail);
    }
    return dedupeOverviewByWeek(rows);
  }, [overview, yearFilter, fromWeek, toWeek, showEmpty, selectedWeek]);

  const rangeAgg = useMemo(() => aggregateOverviewRange(filteredRows), [filteredRows]);
  const isRange = fromWeek !== toWeek;

  const selectedRow = useMemo(
    () => overview.find((r) => r.week === selectedWeek.trim()) ?? null,
    [overview, selectedWeek],
  );

  const verifiedExceptions = useMemo(
    () => countVerifiedFlowExceptions(drill),
    [drill],
  );

  const applyTableRange = useCallback(
    (from: string, to: string) => {
      setCfcField("weekFrom", from);
      setCfcField("weekTo", to);
    },
    [setCfcField],
  );

  const selectWeek = useCallback(
    (week: string) => {
      const wk = week.trim();
      if (!wk) return;
      userPickedWeekRef.current = true;
      drillRequestIdRef.current += 1;
      setSelectedWeek(wk);
      syncWeekToUrl(wk);
      const expanded = expandWeekRangeToInclude(fromWeek, toWeek, wk);
      if (expanded.fromWeek !== fromWeek || expanded.toWeek !== toWeek) {
        applyTableRange(expanded.fromWeek, expanded.toWeek);
      }
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [syncWeekToUrl, fromWeek, toWeek, applyTableRange],
  );

  const shiftWeek = useCallback(
    (dir: -1 | 1) => {
      const next = dir === -1 ? goToPrevWeek(selectedWeek) : goToNextWeek(selectedWeek);
      if (next) selectWeek(next);
    },
    [selectedWeek, selectWeek],
  );

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
          ? "/api/controls/cash-flow/export/excel"
          : "/api/controls/cash-flow/export/pdf";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: wk, workCountry }),
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
    <div className="cfc-page cfc-page--compact" dir="rtl">
      <header className="cfc-toolbar">
        <h1 className="cfc-toolbar__title">
          בקרת תזרים
          <span className="cfc-toolbar__week" dir="ltr">
            {selectedWeek}
          </span>
          {selectedRow ? (
            <small className="cfc-toolbar__dates">{weekDateRange(selectedRow.week, selectedRow.weekLabel)}</small>
          ) : null}
        </h1>

        <div className="cfc-toolbar__nav">
          <button type="button" className="cfc-btn cfc-btn--icon" onClick={() => shiftWeek(-1)} aria-label="שבוע קודם">
            <ChevronRight size={18} />
          </button>
          <select
            className="cfc-week-select"
            value={selectedWeek}
            onChange={(e) => selectWeek(e.target.value)}
            aria-label="בחירת שבוע"
          >
            {weekSelectOptions.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button type="button" className="cfc-btn cfc-btn--icon" onClick={() => shiftWeek(1)} aria-label="שבוע הבא">
            <ChevronLeft size={18} />
          </button>
        </div>

        <div className="cfc-toolbar__actions">
          <button type="button" className="cfc-btn cfc-btn--ghost cfc-btn--sm" onClick={refresh} aria-label="רענון">
            <RefreshCw size={15} />
            רענון
          </button>
          <button type="button" className="cfc-btn cfc-btn--ghost cfc-btn--sm" onClick={() => setManagerCountOpen(true)}>
            <Calculator size={15} />
            ספירת מנהל
          </button>
          {caps.canExport ? (
            <>
              <button
                type="button"
                className="cfc-btn cfc-btn--ghost cfc-btn--sm"
                disabled={!!exporting}
                onClick={() => void exportFile("pdf")}
              >
                <FileText size={15} />
                PDF
              </button>
              <button
                type="button"
                className="cfc-btn cfc-btn--ghost cfc-btn--sm"
                disabled={!!exporting}
                onClick={() => void exportFile("excel")}
              >
                <FileSpreadsheet size={15} />
                Excel
              </button>
            </>
          ) : null}
          <Link className="cfc-btn cfc-btn--ghost cfc-btn--sm" href="/admin/documents">
            <Archive size={15} />
            ארכיון
          </Link>
          <button
            type="button"
            className={`cfc-btn cfc-btn--ghost cfc-btn--sm${verifiedExceptions > 0 ? " cfc-btn--alert" : ""}`}
            onClick={() => setAnomaliesOpen(true)}
          >
            <AlertTriangle size={15} />
            חריגות{verifiedExceptions > 0 ? ` (${verifiedExceptions})` : ""}
          </button>
        </div>
      </header>

      <CashflowPrimaryKpiStrip
        row={selectedRow}
        drill={drill}
        loading={drillLoading}
        onOpenAnomalies={() => setAnomaliesOpen(true)}
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
          userPickedWeekRef.current = false;
          const wk = urlWeek || activeWorkWeek;
          setSelectedWeek(wk);
          applyTableRange(wk, wk);
          syncWeekToUrl(wk);
        }}
        onRefresh={refresh}
        refreshing={loading}
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
        {selectedRow && !isRange ? (
          <CashflowWeekDetailPanel
            week={selectedWeek}
            row={selectedRow}
            drill={drill}
            loading={drillLoading}
            error={drillError}
            workCountry={workCountry}
            onRetry={() => void loadDrillOnly(selectedWeek.trim())}
          />
        ) : selectedRow && isRange && rangeAgg ? (
          <div className="cfc-card">
            <p className="cfc-empty">
              טווח {rangeAgg.fromWeek}–{rangeAgg.toWeek}: {rangeAgg.weekCount} שבועות ·{" "}
              {rangeAgg.alertWeekCount} עם חריגות. בחרו שבוע יחיד בטווח לפירוט מלא.
            </p>
          </div>
        ) : (
          <div className="cfc-card">
            <p className="cfc-empty">בחרו שבוע מהטבלה להצגת פירוט</p>
          </div>
        )}
      </div>
      <CashflowAnomaliesModal
        open={anomaliesOpen}
        week={selectedWeek}
        drill={drill}
        overviewRow={selectedRow}
        onClose={() => setAnomaliesOpen(false)}
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
