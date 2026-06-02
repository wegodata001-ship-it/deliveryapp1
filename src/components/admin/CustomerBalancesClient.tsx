"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
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
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { TableSkeleton } from "@/components/ui/loading";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatIlsDisplay, formatUsdDisplay, parseMoneyString, parseMoneyStringOrZero } from "@/lib/money-format";
import { withQuery } from "@/lib/admin-url-query";
import { ReportWeekNav } from "@/components/admin/ReportWeekNav";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { DEFAULT_WEEK_CODE, getAhWeekCodeFromDateRange } from "@/lib/work-week";

const LIMIT = 25;
const FILTER_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;

const BALANCE_STATUS_OPTIONS: { value: CustomerBalanceDebtFilter; label: string }[] = [
  { value: "ALL", label: "הכל" },
  { value: "OWES", label: "חייב" },
  { value: "BALANCED", label: "מאוזן" },
  { value: "CREDIT", label: "זכות" },
];

const SORT_LABELS: Record<CustomerBalanceSort, string> = {
  balance_desc: "יתרה: גבוה → נמוך",
  balance_asc: "יתרה: נמוך → גבוה",
  name: "שם לקוח",
  orders_total: 'סה"כ הזמנות (ש"ח)',
  week_desc: "שבוע AH: גבוה → נמוך",
  week_asc: "שבוע AH: נמוך → גבוה",
  last_order_desc: "תאריך הזמנה אחרונה: חדש → ישן",
  last_order_asc: "תאריך הזמנה אחרונה: ישן → חדש",
};

type BalanceUiTone = "debt" | "balanced" | "credit";

function dec(value: string): number {
  return parseMoneyStringOrZero(value);
}

function moneyIlsCell(value: string): string {
  return formatIlsDisplay(parseMoneyStringOrZero(value));
}

function moneyUsdCell(value: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(value));
}

function balanceUi(balanceIls: string): { label: string; tone: BalanceUiTone } {
  const n = dec(balanceIls);
  if (n > 0.01) return { label: "חייב", tone: "debt" };
  if (n < -0.01) return { label: "זכות", tone: "credit" };
  return { label: "מאוזן", tone: "balanced" };
}

function balanceToneClass(tone: BalanceUiTone): string {
  if (tone === "debt") return "adm-bal-amt--debt";
  if (tone === "credit") return "adm-bal-amt--credit";
  return "adm-bal-amt--balanced";
}

function statusBadgeClass(tone: BalanceUiTone): string {
  if (tone === "debt") return "adm-bal-status-badge adm-bal-status-badge--debt";
  if (tone === "credit") return "adm-bal-status-badge adm-bal-status-badge--credit";
  return "adm-bal-status-badge adm-bal-status-badge--balanced";
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

function balancesScopeSubtitle(toYmd: string): string | null {
  const to = (toYmd || "").trim();
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) return `יתרות מצטברות · נכון לתאריך ${formatHeDate(to)}`;
  return "יתרות מצטברות · מיום כניסת הלקוח ועד היום";
}

export type BalancesFiltersState = {
  toYmd: string;
  sourceCountry: OrderCountryCode | "";
  sort: CustomerBalanceSort;
};

export type BalancesSearchDraft = {
  code: string;
  name: string;
  phone: string;
  balanceStatus: CustomerBalanceDebtFilter;
  minBalanceIls: string;
  maxBalanceIls: string;
};

function defaultBalancesFilters(): BalancesFiltersState {
  return { toYmd: "", sourceCountry: "", sort: "balance_desc" };
}

function defaultSearchDraft(): BalancesSearchDraft {
  return {
    code: "",
    name: "",
    phone: "",
    balanceStatus: "ALL",
    minBalanceIls: "",
    maxBalanceIls: "",
  };
}

function parseStructuralFromSearchParams(sp: URLSearchParams): Pick<BalancesFiltersState, "toYmd" | "sourceCountry"> {
  const to = sp.get("to") || "";
  const countryRaw = sp.get("country") || "";
  const country = (ORDER_COUNTRY_CODES.includes(countryRaw as OrderCountryCode) ? countryRaw : "") as OrderCountryCode | "";
  return {
    toYmd: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : "",
    sourceCountry: country,
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

export function CustomerBalancesClient() {
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
  const [statsPanelOpen, setStatsPanelOpen] = useState(false);
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

  useEffect(() => {
    const struct = parseStructuralFromSearchParams(new URLSearchParams(sp.toString()));
    setBalancesFilters((f) => ({
      ...f,
      toYmd: struct.toYmd,
      sourceCountry: struct.sourceCountry,
    }));
    setUrlReady(true);
  }, [sp]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchDraft);
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

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
        minBalanceIls: debouncedSearch.minBalanceIls,
        maxBalanceIls: debouncedSearch.maxBalanceIls,
        sort: balancesFilters.sort,
      },
    }),
    [balancesFilters, debouncedSearch],
  );

  useEffect(() => {
    if (!urlReady) return;
    const gen = ++fetchGenRef.current;
    setTableLoading(true);
    setErr(null);
    const perf = (window as any).__WEGO_CUSTCARD_PERF;
    if (perf?.startedAt && typeof perf.refreshBalancesMs === "number") {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - perf.startedAt < 2000) perf.refreshBalancesMs += 1;
    }
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
  }, [urlReady, page, buildListQuery]);

  const searchPending = JSON.stringify(searchDraft) !== JSON.stringify(debouncedSearch);
  const tableBusy = !urlReady || (tableLoading && !payload);

  const syncUrl = useCallback(() => {
    if (!urlReady) return;
    const curTo = sp.get("to") ?? "";
    const curCountry = sp.get("country") ?? "";
    const nextCountry = balancesFilters.sourceCountry || "";
    if (curTo === balancesFilters.toYmd && curCountry === nextCountry) return;
    const nextHref = withQuery(pathname, sp, {
      week: null,
      upto: null,
      from: null,
      to: balancesFilters.toYmd || null,
      country: nextCountry || null,
      modal: null,
    });
    router.replace(nextHref);
  }, [balancesFilters.toYmd, balancesFilters.sourceCountry, pathname, router, sp, urlReady]);

  useEffect(() => {
    syncUrl();
  }, [balancesFilters.toYmd, balancesFilters.sourceCountry, syncUrl]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  const displayWeekCode = useMemo(() => {
    const to = balancesFilters.toYmd.trim();
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return getAhWeekCodeFromDateRange(to, to) ?? DEFAULT_WEEK_CODE;
    }
    return DEFAULT_WEEK_CODE;
  }, [balancesFilters.toYmd]);

  const onBalancesWeekChange = useCallback((_normalizedWeek: string, _fromYmd: string, toYmd: string) => {
    setBalancesFilters((f) => ({ ...f, toYmd }));
    setPage(1);
  }, []);

  function clearPageFilters() {
    setBalancesFilters(defaultBalancesFilters());
    setSearchDraft(defaultSearchDraft());
    setDebouncedSearch(defaultSearchDraft());
    setPage(1);
  }

  const openCustomerCard = useCallback(
    (row: CustomerBalanceRow) => {
      const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
      const t0 = now();
      (window as any).__WEGO_CUSTCARD_PERF = {
        startedAt: t0,
        customerId: row.customerId,
        openModalMs: 0,
        fetchCardMs: 0,
        renderCardMs: 0,
        refreshBalancesMs: 0,
        refreshKpiMs: 0,
        hydrateMs: 0,
      };
      openWindow({
        type: "customerCard",
        props: {
          customerId: row.customerId,
          customerName: row.customerName,
          initialTab: "ledger",
        },
      });
      requestAnimationFrame(() => {
        const perf = (window as any).__WEGO_CUSTCARD_PERF;
        if (!perf || perf.customerId !== row.customerId) return;
        perf.openModalMs = Math.round(now() - t0);
      });
    },
    [openWindow],
  );

  const openCustomerPayment = useCallback(
    (row: CustomerBalanceRow) => {
      const balanceUsd = parseMoneyStringOrZero(row.balanceUSD);
      openWindow({
        type: "paymentsUpdated",
        props: {
          customerId: row.customerId,
          customerName: row.customerName,
          amountUsd: balanceUsd > 0.01 ? balanceUsd.toFixed(2) : null,
        },
      });
    },
    [openWindow],
  );

  const schedulePreview = useCallback((row: CustomerBalanceRow | null) => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!row) {
      hoverIdRef.current = null;
      setHoverId(null);
      setHoverRow(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = row.customerId;
    setHoverId(row.customerId);
    setHoverRow(row);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getCustomerBalancePreviewAction(row.customerId, row.totalBalanceILS, row.ordersCount)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== row.customerId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
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

  const kpiCompact = stats ? (
    <div className="adm-balances-kpi-zone" dir="rtl">
      <div className="adm-balances-kpi-compact-row">
        <div className="adm-balances-kpi-compact" role="group" aria-label="סיכום יתרות">
          <span className="adm-balances-kpi-compact__item adm-balances-kpi-compact__item--debt">
            <TrendingDown className="adm-balances-kpi-compact__icon" size={15} strokeWidth={2.35} aria-hidden />
            <span className="adm-balances-kpi-compact__text">
              לקוחות בחוב: <strong>{stats.withDebtCount.toLocaleString("he-IL")}</strong>
            </span>
          </span>
          <span className="adm-balances-kpi-compact__divider" aria-hidden />
          <span className="adm-balances-kpi-compact__item adm-balances-kpi-compact__item--credit">
            <TrendingUp className="adm-balances-kpi-compact__icon" size={15} strokeWidth={2.35} aria-hidden />
            <span className="adm-balances-kpi-compact__text">
              לקוחות בזכות: <strong>{stats.withCreditCount.toLocaleString("he-IL")}</strong>
            </span>
          </span>
          <span className="adm-balances-kpi-compact__divider" aria-hidden />
          <span className="adm-balances-kpi-compact__item adm-balances-kpi-compact__item--payments">
            <Wallet className="adm-balances-kpi-compact__icon" size={15} strokeWidth={2.35} aria-hidden />
            <span className="adm-balances-kpi-compact__text">
              סה״כ תשלומים:{" "}
              <strong dir="ltr">₪{formatIlsDisplay(parseMoneyStringOrZero(stats.totalPaymentsIls))}</strong>
            </span>
          </span>
          <span className="adm-balances-kpi-compact__divider" aria-hidden />
          <span className="adm-balances-kpi-compact__item adm-balances-kpi-compact__item--open">
            <FileText className="adm-balances-kpi-compact__icon" size={15} strokeWidth={2.35} aria-hidden />
            <span className="adm-balances-kpi-compact__text">
              סה״כ יתרות פתוחות:{" "}
              <strong dir="ltr">₪{formatIlsDisplay(parseMoneyStringOrZero(stats.totalDebtIls))}</strong>
            </span>
          </span>
        </div>
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs adm-balances-stats-toggle"
          aria-expanded={statsPanelOpen}
          onClick={() => setStatsPanelOpen((v) => !v)}
        >
          {statsPanelOpen ? (
            <>
              <ChevronUp size={14} aria-hidden />
              הסתר סטטיסטיקות
            </>
          ) : (
            <>
              <ChevronDown size={14} aria-hidden />
              הצג סטטיסטיקות
            </>
          )}
        </button>
      </div>
      {statsPanelOpen ? (
        <div className="adm-balances-kpi-grid adm-balances-kpi-grid--expanded">
          <div className="adm-balances-kpi-card adm-balances-kpi-card--debt">
            <span className="adm-balances-kpi-lbl">
              <TrendingDown size={14} strokeWidth={2.25} aria-hidden /> מספר לקוחות בחוב
            </span>
            <span className="adm-balances-kpi-val">{stats.withDebtCount.toLocaleString("he-IL")}</span>
          </div>
          <div className="adm-balances-kpi-card adm-balances-kpi-card--credit">
            <span className="adm-balances-kpi-lbl">
              <TrendingUp size={14} strokeWidth={2.25} aria-hidden /> מספר לקוחות בזכות
            </span>
            <span className="adm-balances-kpi-val">{stats.withCreditCount.toLocaleString("he-IL")}</span>
          </div>
          <div className="adm-balances-kpi-card adm-balances-kpi-card--payments adm-balances-kpi-card--wide">
            <span className="adm-balances-kpi-lbl">
              <Wallet size={14} strokeWidth={2.25} aria-hidden /> סה״כ תשלומים
            </span>
            <span className="adm-balances-kpi-val" dir="ltr">
              ₪{formatIlsDisplay(parseMoneyStringOrZero(stats.totalPaymentsIls))}
            </span>
          </div>
          <div className="adm-balances-kpi-card adm-balances-kpi-card--open adm-balances-kpi-card--wide">
            <span className="adm-balances-kpi-lbl">
              <Banknote size={14} strokeWidth={2.25} aria-hidden /> סה״כ יתרות פתוחות
            </span>
            <span className="adm-balances-kpi-val" dir="ltr">
              ₪{formatIlsDisplay(parseMoneyStringOrZero(stats.totalDebtIls))}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="adm-balances-page adm-balances-excel-page adm-balances-page--v2 adm-balances-page--page-scroll adm-page--page-scroll">
      <header className="adm-balances-head">
        <h1>יתרות לקוחות</h1>
        <p>לחיצה על שורה פותחת את כרטסת הלקוח במערכת.</p>
      </header>

      {kpiCompact}

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
              weekCode={displayWeekCode}
              disabled={tableBusy}
              onWeekChange={onBalancesWeekChange}
            />
          </div>
        </div>
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--status">
          <span className="adm-balances-field-label">סטטוס</span>
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
            <span className="adm-balances-field-label">נכון לתאריך</span>
            <input
              className="adm-balances-input"
              type="date"
              value={balancesFilters.toYmd}
              onChange={(e) => {
                setBalancesFilters((f) => ({ ...f, toYmd: e.target.value }));
                setPage(1);
              }}
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
            יתרה מינ׳
            <MoneyInput
              placeholder="מינימום"
              value={parseMoneyString(searchDraft.minBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, minBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
          <label>
            יתרה מקס׳
            <MoneyInput
              placeholder="מקסימום"
              value={parseMoneyString(searchDraft.maxBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, maxBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
        </div>
      ) : null}

      <div className="adm-balances-work">
        {balancesScopeSubtitle(balancesFilters.toYmd) ? (
          <p className="adm-balances-scope-line" role="note">
            {balancesScopeSubtitle(balancesFilters.toYmd)}
          </p>
        ) : null}

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
          <table className="adm-table adm-balances-table adm-balances-table--erp">
            <thead>
              <tr>
                <th className="adm-balances-th-code">קוד לקוח</th>
                <th className="adm-balances-th-name">שם לקוח</th>
                <th className="adm-balances-th-num">סה&quot;כ הזמנות מצטבר</th>
                <th className="adm-balances-th-num">סה&quot;כ הזמנות</th>
                <th className="adm-balances-th-num">סה&quot;כ תשלומים</th>
                <th className="adm-balances-th-balance">יתרה</th>
                <th className="adm-balances-th-status">סטטוס</th>
                <th className="adm-balances-th-actions">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {tableBusy ? (
                <TableSkeleton rows={10} columns={colCount} />
              ) : !payload || payload.rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="adm-table-empty">
                    אין נתונים לטווח שנבחר
                  </td>
                </tr>
              ) : (
                payload.rows.map((row) => {
                  const ui = balanceUi(row.totalBalanceILS);
                  return (
                    <tr
                      key={row.customerId}
                      className="adm-balance-row adm-balance-row--clickable"
                      onClick={() => openCustomerCard(row)}
                      onMouseEnter={() => schedulePreview(row)}
                      onMouseLeave={() => schedulePreview(null)}
                    >
                      <td className="adm-balances-td-code" dir="ltr">
                        {row.customerCode ?? "—"}
                      </td>
                      <td className="adm-balances-td-name">{row.customerName}</td>
                      <td className="adm-balances-td-num">
                        <span dir="ltr">{moneyUsdCell(row.lifetimeOrdersUSD)}</span>
                      </td>
                      <td className="adm-balances-td-num">
                        <span dir="ltr">{moneyIlsCell(row.totalOrdersILS)}</span>
                      </td>
                      <td className="adm-balances-td-num">
                        <span dir="ltr">{moneyIlsCell(row.totalPaymentsILS)}</span>
                      </td>
                      <td className={`adm-balances-td-balance ${balanceToneClass(ui.tone)}`}>
                        <span dir="ltr" className={`adm-bal-amt ${balanceToneClass(ui.tone)}`}>
                          {moneyIlsCell(row.totalBalanceILS)}
                        </span>
                      </td>
                      <td className="adm-balances-td-status">
                        <span className={statusBadgeClass(ui.tone)}>{ui.label}</span>
                      </td>
                      <td className="adm-balances-td-actions">
                        <button
                          type="button"
                          className="adm-balances-action-btn adm-balances-action-btn--ledger"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCustomerCard(row);
                          }}
                        >
                          <span aria-hidden>📄</span>
                          <span className="adm-balances-action-text">כרטסת</span>
                        </button>
                        <button
                          type="button"
                          className="adm-balances-action-btn adm-balances-action-btn--payment"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCustomerPayment(row);
                          }}
                        >
                          <span aria-hidden>💰</span>
                          <span className="adm-balances-action-text">תשלום</span>
                          {parseMoneyStringOrZero(row.balanceUSD) > 1000 ? (
                            <span className="adm-balances-action-warn" title="חוב מעל $1,000" aria-label="חוב גבוה">
                              ⚠️
                            </span>
                          ) : null}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {hoverId && hoverRow && (preview || previewBusy) ? (
          <div className="adm-balances-preview-popover" role="tooltip" dir="rtl">
            {previewBusy && !preview ? (
              <p className="adm-balances-preview-meta">טוען…</p>
            ) : preview ? (
              <>
                <p>
                  <strong>{hoverRow.customerName}</strong>
                </p>
                <p>
                  <span>טלפון</span> <span dir="ltr">{preview.phone}</span>
                </p>
                <p>
                  <span>עיר</span> {preview.city}
                </p>
                <p>
                  <span>הזמנות</span> {preview.ordersCount}
                </p>
                <p>
                  <span>תשלום אחרון</span> {preview.lastPaymentLabel}
                </p>
                <p>
                  <span>יתרה</span>{" "}
                  <span dir="ltr" className={balanceToneClass(balanceUi(preview.balanceIls).tone)}>
                    ₪{moneyIlsCell(preview.balanceIls)}
                  </span>
                </p>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="adm-balances-pagination">
          <button
            type="button"
            className="adm-balances-page-btn"
            disabled={tableLoading || (payload?.page ?? page) <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            הקודם
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              className={
                p === (payload?.page ?? page)
                  ? "adm-balances-page-btn adm-balances-page-btn--active"
                  : "adm-balances-page-btn"
              }
              onClick={() => !tableLoading && setPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="adm-balances-page-btn"
            disabled={tableLoading || (payload?.page ?? page) >= (payload?.totalPages ?? 1)}
            onClick={() => setPage((p) => Math.min(payload?.totalPages ?? 1, p + 1))}
          >
            הבא
          </button>
          <span className="adm-balances-page-meta">{payload?.totalRows ?? 0} לקוחות</span>
        </div>
      </div>
    </div>
  );
}
