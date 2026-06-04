"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  exportCustomerBalancesAction,
  getCustomerBalancePreviewAction,
  listCustomerBalancesAction,
  type CustomerBalanceDebtFilter,
  type CustomerBalanceRow,
  type CustomerBalanceSort,
  type CustomerBalancesPayload,
} from "@/app/admin/balances/actions";
import {
  CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS,
  type CustomerBalanceOrderStatusFilter,
} from "@/lib/customer-balance-order-status-filter";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { TableSkeleton } from "@/components/ui/loading";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatUsdDisplay, parseMoneyString, parseMoneyStringOrZero } from "@/lib/money-format";
import { withQuery } from "@/lib/admin-url-query";
import { CustomerBalancesInsightsBar } from "@/components/admin/CustomerBalancesInsightsBar";
import { ReportWeekNav } from "@/components/admin/ReportWeekNav";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import {
  DEFAULT_WORK_COUNTRY,
  orderCountryCodeForWorkCountry,
  resolveWorkCountryFromSearchParams,
} from "@/lib/work-country";
import { useEnsureActiveWorkWeekOnEnter } from "@/hooks/useEnsureActiveWorkWeekOnEnter";
import {
  balancesSnapshotToYmd,
  DEFAULT_WEEK_CODE,
  normalizeAhWeekCode,
  normalizeYmdRangePair,
  prevWeekCode,
} from "@/lib/work-week";

const LIMIT = 25;
const FILTER_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;

const BALANCE_STATUS_OPTIONS: { value: CustomerBalanceDebtFilter; label: string }[] = [
  { value: "ALL", label: "הכל" },
  { value: "OWES", label: "חוב" },
  { value: "CREDIT", label: "זכות" },
];

type BalancesKpiKey =
  | "OWES"
  | "CREDIT"
  | "OPEN"
  | "READY"
  | "IN_PROGRESS"
  | "CANCELLED"
  | "DEBT_WITHDRAWAL";

const SORT_LABELS: Record<CustomerBalanceSort, string> = {
  balance_desc: "יתרה: גבוה → נמוך",
  balance_asc: "יתרה: נמוך → גבוה",
  name: "שם לקוח",
  orders_total: 'סה"כ הזמנות ($)',
  week_desc: "שבוע AH: גבוה → נמוך",
  week_asc: "שבוע AH: נמוך → גבוה",
  last_order_desc: "תאריך הזמנה אחרונה: חדש → ישן",
  last_order_asc: "תאריך הזמנה אחרונה: ישן → חדש",
};

type BalanceUiTone = "debt" | "balanced" | "credit";

function dec(value: string): number {
  return parseMoneyStringOrZero(value);
}

function moneyUsdCell(value: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(value));
}

function balanceUi(balanceIls: string): { label: string; tone: BalanceUiTone } {
  const n = dec(balanceIls);
  if (n > 0.01) return { label: "🔴 חייב", tone: "debt" };
  if (n < -0.01) return { label: "🟢 זכאי", tone: "credit" };
  return { label: "⚪ מאוזן", tone: "balanced" };
}

function balanceToneClass(tone: BalanceUiTone): string {
  if (tone === "debt") return "adm-bal-amt--debt";
  if (tone === "credit") return "adm-bal-amt--credit";
  return "adm-bal-amt--balanced";
}

function statusChipClass(tone: BalanceUiTone): string {
  if (tone === "debt") return "adm-bal-chip adm-bal-chip--debt";
  if (tone === "credit") return "adm-bal-chip adm-bal-chip--credit";
  return "adm-bal-chip adm-bal-chip--balanced";
}

function balanceRowClass(tone: BalanceUiTone): string {
  return `adm-balances-row-click adm-balances-row--${tone}`;
}

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 1, totalPages - 2));
  const end = Math.min(totalPages, start + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function formatHeDate(ymd: string): string {
  const t = (ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return t;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function balancesScopeSubtitle(weekCode: string, snapshotToYmd: string): string | null {
  const week = (weekCode || "").trim();
  const to = (snapshotToYmd || "").trim();
  if (week && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const prev = prevWeekCode(week);
    if (prev) {
      return `יתרות מצטברות · נכון לסוף ${prev} (${formatHeDate(to)}) · שבוע עבודה ${week}`;
    }
    return `יתרות מצטברות · נכון לתאריך ${formatHeDate(to)}`;
  }
  return "יתרות מצטברות · מיום כניסת הלקוח ועד היום";
}

export type BalancesFiltersState = {
  /** שבוע עבודה שנבחר ב-UI (למשל AH-125) */
  weekCode: string;
  /** תאריך סיום snapshot — סוף השבוע הקודם */
  toYmd: string;
  sourceCountry: OrderCountryCode | "";
  sort: CustomerBalanceSort;
};

export type BalancesSearchDraft = {
  code: string;
  name: string;
  phone: string;
  balanceStatus: CustomerBalanceDebtFilter;
  orderStatus: CustomerBalanceOrderStatusFilter;
  minBalanceIls: string;
  maxBalanceIls: string;
};

function defaultBalancesFilters(): BalancesFiltersState {
  const weekCode = ACTIVE_WORK_WEEK_CODE;
  return {
    weekCode,
    toYmd: balancesSnapshotToYmd(weekCode),
    sourceCountry: orderCountryCodeForWorkCountry(DEFAULT_WORK_COUNTRY),
    sort: "balance_desc",
  };
}

function defaultSearchDraft(): BalancesSearchDraft {
  return {
    code: "",
    name: "",
    phone: "",
    balanceStatus: "ALL",
    orderStatus: "ALL",
    minBalanceIls: "",
    maxBalanceIls: "",
  };
}

function parseStructuralFromSearchParams(sp: URLSearchParams): BalancesFiltersState {
  const weekRaw = sp.get("week") || "";
  const weekCode = normalizeAhWeekCode(weekRaw) ?? ACTIVE_WORK_WEEK_CODE;
  const toParam = sp.get("to") || "";
  const fromParam = sp.get("from") || "";
  let toYmd =
    toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : balancesSnapshotToYmd(weekCode);
  if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    const { to } = normalizeYmdRangePair(fromParam, toParam);
    toYmd = to;
  }
  const workCountry = resolveWorkCountryFromSearchParams(sp);
  const country = orderCountryCodeForWorkCountry(workCountry);
  return {
    weekCode,
    toYmd,
    sourceCountry: country,
    sort: "balance_desc",
  };
}

function downloadBase64(base64: string, filename: string, mime: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openPdfHtml(base64: string) {
  const bin = atob(base64);
  const html = new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

function isKpiActive(key: BalancesKpiKey, draft: BalancesSearchDraft): boolean {
  if (key === "OWES") return draft.balanceStatus === "OWES";
  if (key === "CREDIT") return draft.balanceStatus === "CREDIT";
  if (key === "OPEN") return draft.orderStatus === "OPEN";
  if (key === "READY") return draft.orderStatus === "COMPLETED";
  if (key === "IN_PROGRESS") return draft.orderStatus === "IN_PROGRESS";
  if (key === "CANCELLED") return draft.orderStatus === "CANCELLED";
  return draft.orderStatus === "DEBT_WITHDRAWAL";
}

export function CustomerBalancesClient() {
  useEnsureActiveWorkWeekOnEnter("balances");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { openWindow } = useAdminWindows();
  const [tableLoading, setTableLoading] = useState(false);
  const fetchGenRef = useRef(0);

  const [urlReady, setUrlReady] = useState(false);
  const [balancesFilters, setBalancesFilters] = useState<BalancesFiltersState>(defaultBalancesFilters);
  const [searchDraft, setSearchDraft] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [debouncedSearch, setDebouncedSearch] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [filterOpen, setFilterOpen] = useState(false);
  const [payload, setPayload] = useState<CustomerBalancesPayload | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<CustomerBalanceRow | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof getCustomerBalancePreviewAction>>>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewGen = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  const [refreshSig, setRefreshSig] = useState(0);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  useEffect(() => {
    setBalancesFilters(parseStructuralFromSearchParams(new URLSearchParams(sp.toString())));
    setUrlReady(true);
  }, [sp]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchDraft);
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    function onBalancesRefresh() {
      setRefreshSig((s) => s + 1);
    }
    window.addEventListener("wego:balances-refresh", onBalancesRefresh);
    return () => window.removeEventListener("wego:balances-refresh", onBalancesRefresh);
  }, []);

  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 10_000) {
        setRefreshSig((s) => s + 1);
        hiddenAt = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const buildListQuery = useCallback(
    (p: number) => ({
      page: p,
      limit: LIMIT,
      lifetime: true as const,
      toYmd: balancesFilters.toYmd.trim() || undefined,
      sourceCountry: balancesFilters.sourceCountry,
      filters: {
        code: debouncedSearch.code.trim() || undefined,
        name: debouncedSearch.name.trim() || undefined,
        phone: debouncedSearch.phone.trim() || undefined,
        balanceDebtStatus: debouncedSearch.balanceStatus,
        orderStatus: debouncedSearch.orderStatus,
        minBalanceIls: debouncedSearch.minBalanceIls,
        maxBalanceIls: debouncedSearch.maxBalanceIls,
        sort: balancesFilters.sort,
      },
    }),
    [balancesFilters, debouncedSearch],
  );

  const applySearchPatch = useCallback((patch: Partial<BalancesSearchDraft>) => {
    setSearchDraft((s) => {
      const next = { ...s, ...patch };
      setDebouncedSearch(next);
      return next;
    });
    setPage(1);
  }, []);

  const toggleKpi = useCallback(
    (key: BalancesKpiKey) => {
      const active = isKpiActive(key, debouncedSearch);
      if (key === "OWES") {
        applySearchPatch({ balanceStatus: active ? "ALL" : "OWES" });
      } else if (key === "CREDIT") {
        applySearchPatch({ balanceStatus: active ? "ALL" : "CREDIT" });
      } else if (key === "OPEN") {
        applySearchPatch({ orderStatus: active ? "ALL" : "OPEN" });
      } else if (key === "READY") {
        applySearchPatch({ orderStatus: active ? "ALL" : "COMPLETED" });
      } else if (key === "IN_PROGRESS") {
        applySearchPatch({ orderStatus: active ? "ALL" : "IN_PROGRESS" });
      } else if (key === "CANCELLED") {
        applySearchPatch({ orderStatus: active ? "ALL" : "CANCELLED" });
      } else {
        applySearchPatch({ orderStatus: active ? "ALL" : "DEBT_WITHDRAWAL" });
      }
    },
    [applySearchPatch, debouncedSearch],
  );

  useEffect(() => {
    if (!urlReady) return;
    const gen = ++fetchGenRef.current;
    setTableLoading(true);
    setErr(null);
    void listCustomerBalancesAction(buildListQuery(page))
      .then((next) => {
        if (gen !== fetchGenRef.current) return;
        setPayload(next);
        if (page > 1 && next.rows.length === 0) setPage(1);
      })
      .catch(() => {
        if (gen !== fetchGenRef.current) return;
        setErr("טעינת יתרות נכשלה");
      })
      .finally(() => {
        if (gen !== fetchGenRef.current) return;
        setTableLoading(false);
      });
  }, [urlReady, page, buildListQuery, refreshSig]);

  const searchPending = JSON.stringify(searchDraft) !== JSON.stringify(debouncedSearch);
  const tableBusy = !urlReady || (tableLoading && !payload);

  const syncUrl = useCallback(() => {
    if (!urlReady) return;
    const curTo = sp.get("to") ?? "";
    const curWeek = sp.get("week") ?? "";
    const curCountry = sp.get("country") ?? "";
    const staleFrom = sp.get("from");
    const nextCountry = balancesFilters.sourceCountry || "";
    if (
      curTo === balancesFilters.toYmd &&
      curWeek === balancesFilters.weekCode &&
      curCountry === nextCountry &&
      !staleFrom
    ) {
      return;
    }
    const nextHref = withQuery(pathname, sp, {
      week: balancesFilters.weekCode || null,
      upto: null,
      from: null,
      to: balancesFilters.toYmd || null,
      country: nextCountry || null,
      modal: null,
    });
    router.replace(nextHref);
  }, [balancesFilters.toYmd, balancesFilters.weekCode, balancesFilters.sourceCountry, pathname, router, sp, urlReady]);

  useEffect(() => {
    syncUrl();
  }, [balancesFilters.toYmd, balancesFilters.weekCode, balancesFilters.sourceCountry, syncUrl]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  const onBalancesWeekChange = useCallback((normalizedWeek: string) => {
    setBalancesFilters((f) => ({
      ...f,
      weekCode: normalizedWeek,
      toYmd: balancesSnapshotToYmd(normalizedWeek),
    }));
    setPage(1);
    setRefreshSig((s) => s + 1);
  }, []);

  function clearPageFilters() {
    setBalancesFilters(defaultBalancesFilters());
    setSearchDraft(defaultSearchDraft());
    setDebouncedSearch(defaultSearchDraft());
    setPage(1);
  }

  const openCustomerCard = useCallback(
    (row: CustomerBalanceRow) => {
      if (hoverTimerRef.current != null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      hoverIdRef.current = null;
      setHoverId(null);
      setHoverRow(null);
      setPreview(null);
      setPreviewBusy(false);
      openWindow({
        type: "customerCard",
        props: {
          customerId: row.customerId,
          customerName: row.customerName,
          ledgerSourceCountry: balancesFilters.sourceCountry || null,
        },
      });
    },
    [openWindow, balancesFilters.sourceCountry],
  );

  const schedulePreview = useCallback((row: CustomerBalanceRow) => {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverIdRef.current = row.customerId;
    setHoverId(row.customerId);
    setHoverRow(row);
    const seq = ++previewGen.current;
    setPreviewBusy(true);
    hoverTimerRef.current = window.setTimeout(() => {
      void getCustomerBalancePreviewAction(row.customerId, row.balanceILS, row.ordersCount).then((p) => {
        if (previewGen.current !== seq || hoverIdRef.current !== row.customerId) return;
        setPreview(p);
        setPreviewBusy(false);
      });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  const clearPreview = useCallback(() => {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    hoverIdRef.current = null;
    setHoverId(null);
    setHoverRow(null);
    setPreview(null);
    setPreviewBusy(false);
  }, []);

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportCustomerBalancesAction(buildListQuery(1), kind);
    setExportBusy(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    if (kind === "pdf" && res.mime.startsWith("text/html")) {
      openPdfHtml(res.base64);
    } else {
      downloadBase64(res.base64, res.filename, res.mime);
    }
  }

  const colCount = 8;
  const stats = payload?.stats;
  const statusKpis = payload?.statusBalanceKpis;

  const debtFilterActive = isKpiActive("OWES", debouncedSearch);
  const creditFilterActive = isKpiActive("CREDIT", debouncedSearch);

  const insightsProps =
    stats != null
      ? {
          stats,
          statusKpis,
          totalRows: payload?.totalRows ?? 0,
          pageRows: payload?.rows ?? [],
          debtFilterActive,
          creditFilterActive,
          onToggleDebtFilter: () => toggleKpi("OWES"),
          onToggleCreditFilter: () => toggleKpi("CREDIT"),
          onToggleOrderKpi: (key: BalancesKpiKey) => toggleKpi(key),
          orderKpiActive: (key: BalancesKpiKey) => isKpiActive(key, debouncedSearch),
        }
      : null;

  return (
    <div className="adm-balances-page adm-balances-excel-page adm-balances-page--v2 adm-balances-page--page-scroll adm-page--page-scroll">
      <header className="adm-balances-head">
        <h1>יתרות לקוחות</h1>
        <p>לחיצה על שורה פותחת את כרטסת הלקוח במערכת.</p>
      </header>

      {insightsProps ? (
        <CustomerBalancesInsightsBar
          {...insightsProps}
          part="strip"
          expanded={insightsExpanded}
          onExpandedChange={setInsightsExpanded}
        />
      ) : null}

      {err ? <div className="adm-error adm-balances-error">{err}</div> : null}
      {searchPending ? (
        <p className="adm-balances-search-hint" role="status">
          מעדכן סינון…
        </p>
      ) : null}

      <div className="adm-balances-toolbar-row adm-balances-toolbar-row--primary" dir="rtl">
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--search">
          <span className="adm-balances-field-label">קוד לקוח</span>
          <input
            className="adm-balances-input adm-balances-input--search"
            value={searchDraft.code}
            onChange={(e) => setSearchDraft((s) => ({ ...s, code: e.target.value }))}
            dir="ltr"
            autoComplete="off"
          />
        </label>
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--search">
          <span className="adm-balances-field-label">שם לקוח</span>
          <input
            className="adm-balances-input adm-balances-input--search"
            value={searchDraft.name}
            onChange={(e) => setSearchDraft((s) => ({ ...s, name: e.target.value }))}
            autoComplete="off"
          />
        </label>
        <div className="adm-balances-field adm-balances-field--inline adm-balances-field--week-nav">
          <span className="adm-balances-field-label">שבוע עבודה</span>
          <div className="adm-balances-week-wrap">
            <ReportWeekNav
              weekCode={balancesFilters.weekCode}
              disabled={tableBusy}
              onWeekChange={onBalancesWeekChange}
            />
          </div>
        </div>
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--order-status">
          <span className="adm-balances-field-label">סטטוס הזמנה</span>
          <select
            className="adm-balances-input"
            value={searchDraft.orderStatus}
            onChange={(e) =>
              setSearchDraft((s) => ({
                ...s,
                orderStatus: e.target.value as CustomerBalanceOrderStatusFilter,
              }))
            }
          >
            {CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--status">
          <span className="adm-balances-field-label">מצב יתרה</span>
          <select
            className="adm-balances-input"
            value={searchDraft.balanceStatus}
            onChange={(e) =>
              setSearchDraft((s) => ({ ...s, balanceStatus: e.target.value as CustomerBalanceDebtFilter }))
            }
          >
            {BALANCE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="adm-balances-filters-actions">
          <div className="adm-balances-export-actions" role="group" aria-label="ייצוא דוח">
            <button
              type="button"
              className="adm-export-btn adm-export-btn--pdf adm-balances-export-btn"
              disabled={!!exportBusy || tableBusy}
              title="ייצוא PDF"
              aria-label="ייצוא PDF"
              onClick={() => void runExport("pdf")}
            >
              <FileText size={15} strokeWidth={2.2} aria-hidden />
              <span>{exportBusy === "pdf" ? "…" : "PDF"}</span>
            </button>
            <button
              type="button"
              className="adm-export-btn adm-export-btn--excel adm-balances-export-btn"
              disabled={!!exportBusy || tableBusy}
              title="ייצוא Excel"
              aria-label="ייצוא Excel"
              onClick={() => void runExport("excel")}
            >
              <FileSpreadsheet size={15} strokeWidth={2.2} aria-hidden />
              <span>{exportBusy === "excel" ? "…" : "EXCEL"}</span>
            </button>
          </div>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearPageFilters}>
            נקה
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs adm-balances-advanced-toggle"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            {filterOpen ? "✕ סגור סינון מתקדם" : "🔍 סינון מתקדם"}
          </button>
        </div>
      </div>

      {filterOpen ? (
        <div className="adm-balances-advanced-filters" dir="rtl">
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">נכון לתאריך (snapshot)</span>
            <input
              className="adm-balances-input"
              type="date"
              value={balancesFilters.toYmd}
              readOnly
              title="נגזר משבוע העבודה — סוף השבוע הקודם"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">מדינה</span>
            <select
              className="adm-balances-input"
              value={balancesFilters.sourceCountry}
              onChange={(e) => {
                setBalancesFilters((f) => ({ ...f, sourceCountry: e.target.value as OrderCountryCode | "" }));
                setPage(1);
              }}
            >
              <option value="">כל המדינות</option>
              {ORDER_COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {orderCountryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">מיון</span>
            <select
              className="adm-balances-input"
              value={balancesFilters.sort}
              onChange={(e) => {
                setBalancesFilters((f) => ({ ...f, sort: e.target.value as CustomerBalanceSort }));
                setPage(1);
              }}
            >
              {(Object.keys(SORT_LABELS) as CustomerBalanceSort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            טלפון
            <input
              value={searchDraft.phone}
              onChange={(e) => setSearchDraft((s) => ({ ...s, phone: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label>
            יתרה מינ׳ ($)
            <MoneyInput
              placeholder="מינימום"
              value={parseMoneyString(searchDraft.minBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, minBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
          <label>
            יתרה מקס׳ ($)
            <MoneyInput
              placeholder="מקסימום"
              value={parseMoneyString(searchDraft.maxBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, maxBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
        </div>
      ) : null}

      <div className="adm-balances-work">
        {balancesScopeSubtitle(balancesFilters.weekCode, balancesFilters.toYmd) ? (
          <p className="adm-balances-scope-line" role="note">
            {balancesScopeSubtitle(balancesFilters.weekCode, balancesFilters.toYmd)}
          </p>
        ) : null}
        {payload?.activeOrderStatusFilter && payload.activeOrderStatusFilter !== "ALL" ? (
          <p className="adm-balances-scope-line adm-balances-scope-line--filter" role="note">
            חישוב יתרה לפי הזמנות בסטטוס «
            {CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS.find((o) => o.value === payload.activeOrderStatusFilter)?.label}» ·
            תשלומים לפי כל ההזמנות בטווח
          </p>
        ) : null}

        {insightsProps ? <CustomerBalancesInsightsBar {...insightsProps} part="tableLead" /> : null}

        <div
          className={[
            "adm-balances-table-wrap",
            tableLoading && payload ? "adm-balances-table-wrap--loading" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-busy={tableLoading}
        >
          {tableLoading && payload ? (
            <div className="adm-balances-table-overlay" role="status" aria-label="טוען נתונים">
              <span className="adm-balances-table-spinner" />
            </div>
          ) : null}
          <table className="adm-table adm-table--excel adm-balances-table">
            <thead>
              <tr>
                <th className="adm-balances-th-num">סה&quot;כ הזמנות מצטבר ($)</th>
                <th className="adm-balances-th-num">סה&quot;כ הזמנות ($)</th>
                <th className="adm-balances-th-num">סה&quot;כ תשלומים ($)</th>
                <th className="adm-balances-th-num">יתרה ($)</th>
                <th>סטטוס</th>
                <th>שם לקוח</th>
                <th>קוד לקוח</th>
                <th className="adm-balances-th-actions">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {tableBusy && !payload ? (
                <TableSkeleton rows={10} columns={colCount} />
              ) : payload && payload.rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>אין תוצאות</td>
                </tr>
              ) : (
                payload?.rows.map((r) => {
                  const ui = balanceUi(r.balanceILS);
                  return (
                    <tr
                      key={r.customerId}
                      className={balanceRowClass(ui.tone)}
                      tabIndex={0}
                      role="button"
                      onClick={() => openCustomerCard(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openCustomerCard(r);
                        }
                      }}
                      onMouseEnter={() => schedulePreview(r)}
                      onMouseLeave={clearPreview}
                      onFocus={() => schedulePreview(r)}
                      onBlur={clearPreview}
                    >
                      <td className="adm-balances-td-num" dir="ltr">
                        {moneyUsdCell(r.lifetimeOrdersUSD)}
                      </td>
                      <td className="adm-balances-td-num" dir="ltr">
                        {moneyUsdCell(r.totalOrdersUSD)}
                      </td>
                      <td className="adm-balances-td-num" dir="ltr">
                        {moneyUsdCell(r.totalPaymentsUSD)}
                      </td>
                      <td
                        className={`adm-balances-td-num adm-balances-td-num--hero ${balanceToneClass(ui.tone)}`}
                        dir="ltr"
                      >
                        {moneyUsdCell(r.totalBalanceUSD)}
                      </td>
                      <td className="adm-balances-td-status">
                        <span className={statusChipClass(ui.tone)}>{ui.label}</span>
                      </td>
                      <td>{r.customerName}</td>
                      <td dir="ltr">{r.customerCode ?? "—"}</td>
                      <td className="adm-balances-td-actions">
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCustomerCard(r);
                          }}
                        >
                          כרטסת
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {hoverId && (preview || previewBusy) ? (
          <div className="adm-balances-preview-popover" role="tooltip" dir="rtl">
            {previewBusy && !preview ? (
              <p className="adm-balances-preview-meta">טוען…</p>
            ) : preview ? (
              <>
                <p className="adm-balances-preview-title">{hoverRow?.customerName}</p>
                <p className="adm-balances-preview-meta">
                  <span>הזמנות</span> {preview.ordersCount}
                  <span className="adm-balances-preview-sep">·</span>
                  <span>יתרה</span>{" "}
                  <span dir="ltr">{moneyUsdCell(preview.balanceIls)}</span>
                </p>
                <p className="adm-balances-preview-meta">{preview.lastPaymentLabel}</p>
              </>
            ) : null}
          </div>
        ) : null}

        <footer className="adm-balances-foot">
          <span className="adm-balances-page-meta">{payload?.totalRows ?? 0} לקוחות</span>
          <nav className="adm-balances-pager" aria-label="עימוד">
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--xs"
              disabled={page <= 1 || tableBusy}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              הקודם
            </button>
            {pages.map((n) => (
              <button
                key={n}
                type="button"
                className={n === (payload?.page ?? page) ? "adm-btn adm-btn--xs adm-btn--primary" : "adm-btn adm-btn--ghost adm-btn--xs"}
                disabled={tableBusy}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--xs"
              disabled={!payload || page >= (payload?.totalPages ?? 1) || tableBusy}
              onClick={() => setPage((p) => p + 1)}
            >
              הבא
            </button>
          </nav>
        </footer>
      </div>
    </div>
  );
}
