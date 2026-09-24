"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpen, Coins, FileSpreadsheet, FileText, RefreshCw, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  exportCustomerBalancesAction,
  getCustomerBalancePreviewAction,
  getCustomerBalancesRevisionAction,
  invalidateCustomerBalancesCacheAction,
  listCustomerBalancesAction,
  type CustomerBalanceDebtFilter,
  type CustomerBalanceQuery,
  type CustomerBalanceRow,
  type CustomerBalanceSort,
  type CustomerBalancesPayload,
} from "@/app/admin/balances/actions";
import { customerBalancesDataRevision } from "@/lib/customer-balances-revision";
import {
  CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS,
  type CustomerBalanceOrderStatusFilter,
} from "@/lib/customer-balance-order-status-filter";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { TableSkeleton } from "@/components/ui/loading";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatUsdDisplay, parseMoneyString, parseMoneyStringOrZero } from "@/lib/money-format";
import { useDisplayExchangeRate } from "@/components/admin/DisplayExchangeRateContext";
import { UsdBalanceIlsGrossText } from "@/components/admin/UsdBalanceIlsGrossText";
import { currentSearchHref, withQuery } from "@/lib/admin-url-query";
import { CustomerBalancesInsightsBar } from "@/components/admin/CustomerBalancesInsightsBar";
import { rowOrdersUsdSplit } from "@/lib/customer-balances-display";
import { buildCustomerFinancialState } from "@/lib/customer-account-balances-shared";
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
  formatLocalYmd,
  normalizeAhWeekCode,
  prevWeekCode,
} from "@/lib/work-week";
import {
  balancesListCacheKey,
  fetchBalancesListCached,
  getBalancesListCache,
  invalidateBalancesListCache,
} from "@/lib/balances-client-cache";
import {
  BALANCES_FETCH_TIMEOUT_MS,
  BALANCES_LOAD_FAILED_MESSAGE,
  toSafeBalancesListError,
} from "@/lib/balances-list-load";
import { invalidateCustomerCardSnapshotClient } from "@/lib/customer-card-snapshot-client";
import {
  BALANCES_FROM_PARAM,
  BALANCES_RANGE_TO_PARAM,
  BALANCES_TO_PARAM,
  BALANCES_WEEK_PARAM,
  balancesCardOpenProps,
  balancesCumulativeCutoffCaption,
  balancesWeekQueryPatch,
  isBalancesWeekReady,
  parseBalancesWeekFromSearchParams,
} from "@/lib/balances-week-filter";
import { downloadBase64File } from "@/lib/pdf-export-client";
import { CustomerCommissionResetModal } from "@/components/admin/CustomerCommissionResetModal";
import { CommissionAmountButton } from "@/components/admin/CommissionAmountButton";
import { CommissionBalancePopover } from "@/components/admin/CommissionBalancePopover";
import { OrderCommissionDetailModal } from "@/components/admin/OrderCommissionDetailModal";

const LIMIT = 25;
const FILTER_DEBOUNCE_MS = 300;
const PREVIEW_DEBOUNCE_MS = 280;
const BALANCES_AUTO_CHECK_MS = 60_000;

const BALANCE_STATUS_OPTIONS: { value: CustomerBalanceDebtFilter; label: string }[] = [
  { value: "ALL", label: "הכל" },
  { value: "OWES", label: "חוב" },
  { value: "CREDIT", label: "יתרת זכות" },
  { value: "BALANCED", label: "מאוזן" },
];

const SORT_LABELS: Record<CustomerBalanceSort, string> = {
  balance_desc: "חוב פתוח: גבוה → נמוך",
  balance_asc: "חוב פתוח: נמוך → גבוה",
  name: "שם לקוח",
  orders_total: 'סה"כ הזמנות ($)',
  week_desc: "שבוע AH: גבוה → נמוך",
  week_asc: "שבוע AH: נמוך → גבוה",
  last_order_desc: "תאריך הזמנה אחרונה: חדש → ישן",
  last_order_asc: "תאריך הזמנה אחרונה: ישן → חדש",
};

type BalanceUiTone = "debt" | "balanced" | "credit";

function moneyUsdCell(value: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(value));
}

function balanceUiFromRow(row: {
  totalBalanceUSD: string;
  availableCreditUSD?: string;
}): { label: string; tone: BalanceUiTone; amount: string; usd: number } {
  const state = buildCustomerFinancialState({
    openDebtUsd: Math.max(0, parseMoneyStringOrZero(row.totalBalanceUSD)),
    availableCreditUsd: Math.max(0, parseMoneyStringOrZero(row.availableCreditUSD ?? "0")),
  });
  return {
    label: state.statusLabel,
    tone: state.tone,
    amount: state.amountFormatted,
    usd: state.displayAmountUsd,
  };
}

function usdStatDisplay(value: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(value));
}


function statusChipClass(tone: BalanceUiTone): string {
  if (tone === "debt") return "adm-bal-badge adm-bal-badge--debt";
  if (tone === "credit") return "adm-bal-badge adm-bal-badge--credit";
  return "adm-bal-badge adm-bal-badge--balanced";
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

function balancesScopeSubtitle(
  weekCode: string,
  snapshotToYmd: string,
  rangeFromYmd: string,
  rangeToYmd: string,
): string | null {
  const rangeFrom = rangeFromYmd.trim();
  const rangeTo = rangeToYmd.trim();
  if (rangeFrom || rangeTo) {
    const fromLabel = rangeFrom ? formatHeDate(rangeFrom) : "תחילת ההיסטוריה";
    const toLabel = rangeTo ? formatHeDate(rangeTo) : formatHeDate(formatLocalYmd(new Date()));
    return `יתרות לפי טווח תאריכים: ${fromLabel} — ${toLabel}`;
  }

  const week = (weekCode || "").trim();
  const to = (snapshotToYmd || "").trim();
  if (week && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return balancesCumulativeCutoffCaption({
      selectedWeekCode: week,
      cutoffWeekCode: prevWeekCode(week),
      cutoffYmd: to,
    });
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return balancesCumulativeCutoffCaption({
      selectedWeekCode: week,
      cutoffYmd: to,
    });
  }
  return null;
}

function isBalancesDateRangeActive(filters: Pick<BalancesFiltersState, "rangeFromYmd" | "rangeToYmd">): boolean {
  return Boolean(filters.rangeFromYmd.trim() || filters.rangeToYmd.trim());
}

function resolveBalancesQueryScope(filters: Pick<BalancesFiltersState, "weekCode" | "toYmd" | "sourceCountry">) {
  const week = normalizeAhWeekCode(filters.weekCode) ?? ACTIVE_WORK_WEEK_CODE;
  return {
    week,
    snapshotWeek: prevWeekCode(week),
    country: filters.sourceCountry,
    snapshotTo: filters.toYmd?.trim() || balancesSnapshotToYmd(week),
  };
}

function buildCustomerBalancesListQuery(
  page: number,
  filters: BalancesFiltersState,
  search: BalancesSearchDraft,
  scope: ReturnType<typeof resolveBalancesQueryScope>,
): CustomerBalanceQuery {
  const dateRangeActive = isBalancesDateRangeActive(filters);
  return {
    page,
    limit: LIMIT,
    weekCode: scope.week,
    ...(dateRangeActive
      ? {
          fromYmd: filters.rangeFromYmd.trim() || undefined,
          toYmd: filters.rangeToYmd.trim() || formatLocalYmd(new Date()),
        }
      : {
          uptoWeekCode: scope.snapshotWeek ?? undefined,
          toYmd: scope.snapshotTo,
        }),
    sourceCountry: scope.country,
    filters: {
      code: search.code.trim() || undefined,
      name: search.name.trim() || undefined,
      phone: search.phone.trim() || undefined,
      balanceDebtStatus: search.balanceStatus,
      orderStatus: search.orderStatus,
      minBalanceIls: search.minBalanceIls,
      maxBalanceIls: search.maxBalanceIls,
      showBalanced: search.showBalanced || undefined,
      sort: filters.sort,
    },
  };
}


export type BalancesFiltersState = {
  /** שבוע עבודה שנבחר ב-UI (למשל AH-125) */
  weekCode: string;
  /** תאריך סיום snapshot — סוף השבוע הקודם */
  toYmd: string;
  /** טווח תאריכים — מתאריך (ריק = כל ההיסטוריה) */
  rangeFromYmd: string;
  /** טווח תאריכים — עד תאריך (ריק = היום) */
  rangeToYmd: string;
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
  /** ברירת מחדל: false — לא מציג לקוחות מאוזנים */
  showBalanced: boolean;
};

function defaultBalancesFilters(): BalancesFiltersState {
  const weekCode = ACTIVE_WORK_WEEK_CODE;
  return {
    weekCode,
    toYmd: balancesSnapshotToYmd(weekCode),
    rangeFromYmd: "",
    rangeToYmd: "",
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
    showBalanced: false,
  };
}

function parseStructuralFromSearchParams(sp: URLSearchParams): BalancesFiltersState {
  const { weekCode, toYmd, rangeFromYmd, rangeToYmd } = parseBalancesWeekFromSearchParams(sp);
  const workCountry = resolveWorkCountryFromSearchParams(sp);
  const country = orderCountryCodeForWorkCountry(workCountry);
  return {
    weekCode,
    toYmd,
    rangeFromYmd,
    rangeToYmd,
    sourceCountry: country,
    sort: "balance_desc",
  };
}

export function CustomerBalancesClient({
  canResetViaCommissions = false,
}: {
  canResetViaCommissions?: boolean;
}) {
  useEnsureActiveWorkWeekOnEnter("balances");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { openWindow, stack: adminWindowStack } = useAdminWindows();
  const exchangeRate = useDisplayExchangeRate();
  const [tableLoading, setTableLoading] = useState(true);
  const fetchGenRef = useRef(0);

  const balancesWeekParam = sp.get(BALANCES_WEEK_PARAM) ?? "";
  const balancesToParam = sp.get(BALANCES_TO_PARAM) ?? "";
  const balancesFromParam = sp.get(BALANCES_FROM_PARAM) ?? "";
  const balancesRangeToParam = sp.get(BALANCES_RANGE_TO_PARAM) ?? "";
  const countryParam = sp.get("country") ?? "";
  const searchKey = sp.toString();
  const urlReady = isBalancesWeekReady(sp);
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
  const [manualRefreshBusy, setManualRefreshBusy] = useState(false);
  const [newDataAvailable, setNewDataAvailable] = useState(false);
  const softRefreshPendingRef = useRef(false);
  const skipCacheNextRef = useRef(false);
  const payloadRevisionRef = useRef("");
  const staleCheckGenRef = useRef(0);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const [displayedQueryKey, setDisplayedQueryKey] = useState<string | null>(null);
  const [commissionResetRow, setCommissionResetRow] = useState<CustomerBalanceRow | null>(null);
  const [commissionDetailCustomer, setCommissionDetailCustomer] = useState<{
    customerId: string;
    customerName: string;
    commissionUsd: number;
  } | null>(null);
  const [orderCommissionDetail, setOrderCommissionDetail] = useState<{
    orderId: string;
    orderNumber: string | null;
  } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  /** מקור יחיד לשאילתה — מסונכרן עם תצוגת השבוע (לא ממתין לעדכון URL) */
  const balancesQueryScope = useMemo(
    () => resolveBalancesQueryScope(balancesFilters),
    [balancesFilters.weekCode, balancesFilters.toYmd, balancesFilters.sourceCountry],
  );

  useEffect(() => {
    if (!urlReady) return;
    const parsed = parseStructuralFromSearchParams(
      new URLSearchParams({
        [BALANCES_WEEK_PARAM]: balancesWeekParam,
        [BALANCES_TO_PARAM]: balancesToParam,
        [BALANCES_FROM_PARAM]: balancesFromParam,
        [BALANCES_RANGE_TO_PARAM]: balancesRangeToParam,
        country: countryParam,
      }),
    );
    if (!parsed.weekCode) return;
    setBalancesFilters((f) => {
      if (
        f.weekCode === parsed.weekCode &&
        f.toYmd === parsed.toYmd &&
        f.rangeFromYmd === parsed.rangeFromYmd &&
        f.rangeToYmd === parsed.rangeToYmd &&
        f.sourceCountry === parsed.sourceCountry
      ) {
        return f;
      }
      return { ...parsed, sort: f.sort };
    });
  }, [
    urlReady,
    balancesWeekParam,
    balancesToParam,
    balancesFromParam,
    balancesRangeToParam,
    countryParam,
  ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch((prev) => {
        if (
          prev.code === searchDraft.code &&
          prev.name === searchDraft.name &&
          prev.phone === searchDraft.phone &&
          prev.minBalanceIls === searchDraft.minBalanceIls &&
          prev.maxBalanceIls === searchDraft.maxBalanceIls
        ) {
          return prev;
        }
        return {
          ...prev,
          code: searchDraft.code,
          name: searchDraft.name,
          phone: searchDraft.phone,
          minBalanceIls: searchDraft.minBalanceIls,
          maxBalanceIls: searchDraft.maxBalanceIls,
        };
      });
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchDraft.code, searchDraft.name, searchDraft.phone, searchDraft.minBalanceIls, searchDraft.maxBalanceIls]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const softRefreshBalances = useCallback(() => {
    softRefreshPendingRef.current = true;
    skipCacheNextRef.current = true;
    invalidateBalancesListCache();
    void invalidateCustomerBalancesCacheAction();
    setNewDataAvailable(false);
    setErr(null);
    setRefreshSig((s) => s + 1);
  }, []);

  useEffect(() => {
    function onBalancesRefresh() {
      softRefreshBalances();
    }
    window.addEventListener("wego:balances-refresh", onBalancesRefresh);
    return () => window.removeEventListener("wego:balances-refresh", onBalancesRefresh);
  }, [softRefreshBalances]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt > 10_000) {
        softRefreshBalances();
        hiddenAt = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [softRefreshBalances]);

  const buildListQuery = useCallback(
    (p: number) => buildCustomerBalancesListQuery(p, balancesFilters, debouncedSearch, balancesQueryScope),
    [balancesFilters, balancesQueryScope, debouncedSearch],
  );

  useEffect(() => {
    if (!balancesFilters.weekCode) return;
    const gen = ++fetchGenRef.current;
    const query = buildListQuery(page);
    const cacheKey = balancesListCacheKey(query);
    const skipCache = skipCacheNextRef.current;
    skipCacheNextRef.current = false;
    const isSoftRefresh = softRefreshPendingRef.current;
    if (isSoftRefresh) {
      softRefreshPendingRef.current = false;
      setManualRefreshBusy(true);
    }

    if (!skipCache) {
      const cached = getBalancesListCache(cacheKey);
      if (cached) {
        setPayload(cached);
        setDisplayedQueryKey(cacheKey);
        payloadRevisionRef.current = customerBalancesDataRevision(cached);
        setNewDataAvailable(false);
        setTableLoading(false);
        setManualRefreshBusy(false);
        console.log("[balances-client-fetch]", {
          week: query.weekCode,
          country: query.sourceCountry,
          page: query.page,
          cacheHit: true,
          ms: 0,
        });
        return;
      }
    }

    if (!isSoftRefresh) setTableLoading(true);
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log("[balances-client-fetch]", {
      week: query.weekCode,
      uptoWeek: query.uptoWeekCode,
      from: query.fromYmd,
      country: query.sourceCountry,
      to: query.toYmd,
      page: query.page,
      refreshSig,
      soft: isSoftRefresh,
      cacheHit: false,
    });
    setErr(null);
    void fetchBalancesListCached(cacheKey, () => listCustomerBalancesAction({ ...query, skipCache }), {
      skipCache,
      timeoutMs: BALANCES_FETCH_TIMEOUT_MS,
    })
      .then((next) => {
        if (gen !== fetchGenRef.current) return;
        setPayload(next);
        setDisplayedQueryKey(cacheKey);
        payloadRevisionRef.current = customerBalancesDataRevision(next);
        setNewDataAvailable(false);
        setErr(null);
        if (page > 1 && next.rows.length === 0) setPage(1);
        console.log("[balances-client-fetch-done]", {
          week: query.weekCode,
          ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0),
        });
      })
      .catch((error: unknown) => {
        if (gen !== fetchGenRef.current) return;
        setErr(toSafeBalancesListError(error).message || BALANCES_LOAD_FAILED_MESSAGE);
      })
      .finally(() => {
        if (gen !== fetchGenRef.current) return;
        setTableLoading(false);
        setManualRefreshBusy(false);
      });
  }, [
    balancesFilters.weekCode,
    page,
    refreshSig,
    balancesQueryScope.week,
    balancesQueryScope.snapshotTo,
    balancesQueryScope.country,
    balancesFilters.rangeFromYmd,
    balancesFilters.rangeToYmd,
    balancesFilters.sort,
    debouncedSearch,
    buildListQuery,
  ]);

  const searchPending = JSON.stringify(searchDraft) !== JSON.stringify(debouncedSearch);
  const currentListQueryKey = balancesListCacheKey(buildListQuery(page));
  const queryMatchesView = displayedQueryKey === currentListQueryKey;
  const displayPayload = payload;
  const initialLoading = !payload && tableLoading;
  const refreshing = !!payload && (tableLoading || !queryMatchesView);
  const tableBusy = initialLoading;
  const weekNavLocked = !!exportBusy;
  const urlModalOpen = Boolean(sp.get("modal")?.trim());
  const overlayBlocksAutoCheckRef = useRef(false);
  overlayBlocksAutoCheckRef.current =
    adminWindowStack.length > 0 || urlModalOpen || Boolean(exportBusy) || manualRefreshBusy || tableLoading;

  useEffect(() => {
    if (!payload) return;

    const checkForNewData = () => {
      if (document.hidden) return;
      if (overlayBlocksAutoCheckRef.current) return;
      const gen = ++staleCheckGenRef.current;
      const query = buildListQuery(page);
      void getCustomerBalancesRevisionAction(query)
        .then((revision) => {
          if (gen !== staleCheckGenRef.current) return;
          if (!payloadRevisionRef.current) {
            payloadRevisionRef.current = revision;
            return;
          }
          if (revision !== payloadRevisionRef.current) {
            setNewDataAvailable(true);
          }
        })
        .catch(() => {
          /* ignore background check errors */
        });
    };

    const id = window.setInterval(checkForNewData, BALANCES_AUTO_CHECK_MS);
    return () => window.clearInterval(id);
  }, [payload, buildListQuery, page]);

  useEffect(() => {
    if (!balancesFilters.weekCode) return;
    const snapshotTo = balancesFilters.toYmd?.trim() || balancesSnapshotToYmd(balancesFilters.weekCode);
    const current = new URLSearchParams(searchKey);
    const nextHref = withQuery(
      pathname,
      current,
      balancesWeekQueryPatch(
        balancesFilters.weekCode,
        snapshotTo,
        balancesFilters.rangeFromYmd,
        balancesFilters.rangeToYmd,
      ),
    );
    if (nextHref === currentSearchHref(pathname, current)) return;
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  }, [
    balancesFilters.weekCode,
    balancesFilters.toYmd,
    balancesFilters.rangeFromYmd,
    balancesFilters.rangeToYmd,
    pathname,
    router,
    balancesWeekParam,
    balancesToParam,
    balancesFromParam,
    balancesRangeToParam,
    searchKey,
  ]);

  const pages = useMemo(
    () => pageNumbers(displayPayload?.page ?? page, displayPayload?.totalPages ?? 1),
    [displayPayload?.page, displayPayload?.totalPages, page],
  );

  const onBalancesWeekChange = useCallback((normalizedWeek: string) => {
    const nextFilters: BalancesFiltersState = {
      ...balancesFilters,
      weekCode: normalizedWeek,
      toYmd: balancesSnapshotToYmd(normalizedWeek),
    };
    setBalancesFilters(nextFilters);
    setPage(1);
    const query = buildCustomerBalancesListQuery(1, nextFilters, debouncedSearch, resolveBalancesQueryScope(nextFilters));
    const key = balancesListCacheKey(query);
    const cached = getBalancesListCache(key);
    if (cached) {
      setPayload(cached);
      setDisplayedQueryKey(key);
      payloadRevisionRef.current = customerBalancesDataRevision(cached);
      setTableLoading(false);
    }
  }, [balancesFilters, debouncedSearch]);

  function clearPageFilters() {
    setBalancesFilters(defaultBalancesFilters());
    setSearchDraft(defaultSearchDraft());
    setDebouncedSearch(defaultSearchDraft());
    setPage(1);
  }

  function clearAdvancedFilters() {
    setBalancesFilters((f) => ({
      ...f,
      rangeFromYmd: "",
      rangeToYmd: "",
      sourceCountry: orderCountryCodeForWorkCountry(DEFAULT_WORK_COUNTRY),
      sort: "balance_desc",
    }));
    setSearchDraft((s) => ({
      ...s,
      phone: "",
      minBalanceIls: "",
      maxBalanceIls: "",
      showBalanced: false,
    }));
    setDebouncedSearch((s) => ({
      ...s,
      phone: "",
      minBalanceIls: "",
      maxBalanceIls: "",
      showBalanced: false,
    }));
    setPage(1);
  }

  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (balancesFilters.rangeFromYmd.trim()) count += 1;
    if (balancesFilters.rangeToYmd.trim()) count += 1;
    if (debouncedSearch.showBalanced) count += 1;
    if (debouncedSearch.phone.trim()) count += 1;
    if (debouncedSearch.minBalanceIls.trim()) count += 1;
    if (debouncedSearch.maxBalanceIls.trim()) count += 1;
    if (
      balancesFilters.sourceCountry &&
      balancesFilters.sourceCountry !== orderCountryCodeForWorkCountry(DEFAULT_WORK_COUNTRY)
    ) {
      count += 1;
    }
    if (balancesFilters.sort !== "balance_desc") count += 1;
    return count;
  }, [
    balancesFilters.rangeFromYmd,
    balancesFilters.rangeToYmd,
    balancesFilters.sourceCountry,
    balancesFilters.sort,
    debouncedSearch.minBalanceIls,
    debouncedSearch.phone,
    debouncedSearch.showBalanced,
    debouncedSearch.maxBalanceIls,
  ]);

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
      const scope = resolveBalancesQueryScope(balancesFilters);
      const cardProps = balancesCardOpenProps({
        weekCode: scope.week,
        snapshotToYmd: scope.snapshotTo,
        rangeFromYmd: balancesFilters.rangeFromYmd,
        rangeToYmd: balancesFilters.rangeToYmd,
        sourceCountry: balancesFilters.sourceCountry,
      });
      openWindow({
        type: "customerCard",
        props: {
          customerId: row.customerId,
          customerName: row.customerName,
          initialTab: "ledger",
          ...cardProps,
        },
      });
    },
    [openWindow, balancesFilters],
  );

  const schedulePreview = useCallback((row: CustomerBalanceRow) => {
    if (hoverTimerRef.current != null) window.clearTimeout(hoverTimerRef.current);
    hoverIdRef.current = row.customerId;
    setHoverId(row.customerId);
    setHoverRow(row);
    const seq = ++previewGen.current;
    setPreviewBusy(true);
    hoverTimerRef.current = window.setTimeout(() => {
      void getCustomerBalancePreviewAction(row.customerId, row.balanceILS, row.ordersCount)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== row.customerId) return;
          setPreview(p);
        })
        .catch(() => {
          if (previewGen.current !== seq || hoverIdRef.current !== row.customerId) return;
          setPreview(null);
        })
        .finally(() => {
          if (previewGen.current !== seq || hoverIdRef.current !== row.customerId) return;
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
    try {
      const exportQuery = {
        ...buildListQuery(1),
        limit: Math.max(payload?.totalRows ?? 0, 10000),
      };
      const res = await exportCustomerBalancesAction(exportQuery, kind);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      downloadBase64File(res.base64, res.filename, res.mime);
    } catch {
      setErr(BALANCES_LOAD_FAILED_MESSAGE);
    } finally {
      setExportBusy(null);
    }
  }

  const colCount = 11;
  const stats = displayPayload?.stats;

  const heroActions = (
    <div className="adm-balances-hero__actions" role="group" aria-label="פעולות מסך">
      <button
        type="button"
        className="adm-balances-hero__btn adm-balances-hero__btn--secondary"
        disabled={tableBusy || !stats}
        aria-expanded={insightsExpanded}
        onClick={() => setInsightsExpanded((v) => !v)}
      >
        <BarChart3 size={15} strokeWidth={2} aria-hidden />
        {insightsExpanded ? "הסתר סטטיסטיקה" : "הצג סטטיסטיקה"}
      </button>
      <button
        type="button"
        className="adm-balances-hero__btn adm-balances-hero__btn--secondary"
        disabled={!!exportBusy || tableBusy || manualRefreshBusy}
        title="רענון נתוני הדוח"
        aria-label="רענון נתוני הדוח"
        onClick={() => {
          if (manualRefreshBusy || tableLoading) return;
          softRefreshBalances();
        }}
      >
        <RefreshCw
          size={15}
          strokeWidth={2.2}
          aria-hidden
          className={manualRefreshBusy ? "adm-balances-refresh-spin" : undefined}
        />
        {manualRefreshBusy ? "…" : "רענון"}
      </button>
      <button
        type="button"
        className="adm-balances-hero__btn adm-balances-hero__btn--pdf"
        disabled={!!exportBusy || tableBusy}
        title="ייצוא PDF"
        aria-label="ייצוא PDF"
        onClick={() => void runExport("pdf")}
      >
        <FileText size={15} strokeWidth={2.2} aria-hidden />
        {exportBusy === "pdf" ? "…" : "PDF"}
      </button>
      <button
        type="button"
        className="adm-balances-hero__btn adm-balances-hero__btn--excel"
        disabled={!!exportBusy || tableBusy}
        title="ייצוא Excel"
        aria-label="ייצוא Excel"
        onClick={() => void runExport("excel")}
      >
        <FileSpreadsheet size={15} strokeWidth={2.2} aria-hidden />
        {exportBusy === "excel" ? "…" : "Excel"}
      </button>
    </div>
  );

  const advancedFiltersPanel = filterOpen ? (
    <div className="adm-balances-filters-card__advanced" dir="rtl">
      <div className="adm-balances-filters-card__advanced-section">
        <h3 className="adm-balances-filters-card__advanced-title">טווח תאריכים</h3>
        <div className="adm-balances-filters-card__advanced-grid">
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--date">
            <span className="adm-balances-field-label">מתאריך</span>
            <input
              className="adm-balances-input adm-balances-input--date"
              type="date"
              value={balancesFilters.rangeFromYmd}
              onChange={(e) => {
                setBalancesFilters((f) => ({ ...f, rangeFromYmd: e.target.value }));
                setPage(1);
              }}
              dir="ltr"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--date">
            <span className="adm-balances-field-label">עד תאריך</span>
            <input
              className="adm-balances-input adm-balances-input--date"
              type="date"
              value={balancesFilters.rangeToYmd}
              onChange={(e) => {
                setBalancesFilters((f) => ({ ...f, rangeToYmd: e.target.value }));
                setPage(1);
              }}
              dir="ltr"
              title="ריק = היום"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--date">
            <span className="adm-balances-field-label">נכון לתאריך</span>
            <input
              className="adm-balances-input adm-balances-input--date"
              type="date"
              value={balancesFilters.toYmd}
              readOnly
              title="נגזר משבוע העבודה — סוף השבוע הקודם"
            />
          </label>
        </div>
      </div>

      <div className="adm-balances-filters-card__advanced-section">
        <h3 className="adm-balances-filters-card__advanced-title">מצב לקוחות</h3>
        <label className="adm-balances-field adm-balances-field--inline adm-balances-field--checkbox-adv">
          <span className="adm-balances-checkbox-wrap">
            <input
              type="checkbox"
              checked={searchDraft.showBalanced}
              onChange={(e) => {
                const showBalanced = e.target.checked;
                setSearchDraft((s) => ({ ...s, showBalanced }));
                setDebouncedSearch((s) => ({ ...s, showBalanced }));
              }}
            />
            <span>הצג גם לקוחות מאוזנים</span>
          </span>
          <span className="adm-balances-field-hint">כולל לקוחות שחוב פתוח ויתרת זכות שלהם $0</span>
        </label>
      </div>

      <div className="adm-balances-filters-card__advanced-section">
        <h3 className="adm-balances-filters-card__advanced-title">סינון נוסף</h3>
        <div className="adm-balances-filters-card__advanced-grid">
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
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">טלפון</span>
            <input
              className="adm-balances-input"
              value={searchDraft.phone}
              onChange={(e) => setSearchDraft((s) => ({ ...s, phone: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">חוב פתוח מינ׳ ($)</span>
            <MoneyInput
              placeholder="מינימום"
              value={parseMoneyString(searchDraft.minBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, minBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline">
            <span className="adm-balances-field-label">חוב פתוח מקס׳ ($)</span>
            <MoneyInput
              placeholder="מקסימום"
              value={parseMoneyString(searchDraft.maxBalanceIls)}
              onChange={(n) => setSearchDraft((s) => ({ ...s, maxBalanceIls: n == null ? "" : String(n) }))}
            />
          </label>
        </div>
      </div>

      <div className="adm-balances-filters-card__advanced-foot">
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          onClick={clearAdvancedFilters}
          disabled={advancedFilterCount === 0}
        >
          נקה סינון מתקדם
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="adm-balances-page adm-balances-excel-page adm-balances-page--v2 adm-balances-page--fcc adm-balances-page--page-scroll adm-page--page-scroll">
      <header className="adm-balances-hero" dir="rtl">
        <div className="adm-balances-hero__text">
          <h1 className="adm-balances-hero__title">מרכז ניהול יתרות לקוחות</h1>
          <p className="adm-balances-hero__desc">ניהול חובות, תשלומים ויתרות פתוחות</p>
        </div>
        {heroActions}
      </header>

      {err ? (
        <div className="adm-error adm-balances-error" role="alert" dir="rtl">
          <span>{err}</span>
          <button
            type="button"
            className="adm-btn adm-btn--secondary adm-btn--xs"
            disabled={manualRefreshBusy || tableLoading}
            onClick={() => {
              if (manualRefreshBusy || tableLoading) return;
              softRefreshBalances();
            }}
          >
            נסה שוב
          </button>
        </div>
      ) : null}
      {searchPending ? (
        <p className="adm-balances-search-hint" role="status">
          מעדכן סינון…
        </p>
      ) : null}

      <div className="adm-balances-filters-card">
        <div className="adm-balances-filters-card__primary" dir="rtl">
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--code">
            <span className="adm-balances-field-label">קוד לקוח</span>
            <input
              className="adm-balances-input adm-balances-input--search"
              value={searchDraft.code}
              onChange={(e) => setSearchDraft((s) => ({ ...s, code: e.target.value }))}
              dir="ltr"
              autoComplete="off"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--name">
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
                disabled={weekNavLocked}
                loading={tableLoading && !payload}
                onWeekChange={onBalancesWeekChange}
              />
            </div>
          </div>
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--order-status">
            <span className="adm-balances-field-label">סטטוס הזמנה</span>
            <select
              className="adm-balances-input"
              value={searchDraft.orderStatus}
              onChange={(e) => {
                const orderStatus = e.target.value as CustomerBalanceOrderStatusFilter;
                setSearchDraft((s) => ({ ...s, orderStatus }));
                setDebouncedSearch((s) => ({ ...s, orderStatus }));
              }}
            >
              {CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-balances-field adm-balances-field--inline adm-balances-field--status">
            <span className="adm-balances-field-label">מצב חשבון</span>
            <select
              className="adm-balances-input"
              value={searchDraft.balanceStatus}
              onChange={(e) => {
                const balanceStatus = e.target.value as CustomerBalanceDebtFilter;
                setSearchDraft((s) => ({ ...s, balanceStatus }));
                setDebouncedSearch((s) => ({ ...s, balanceStatus }));
              }}
            >
              {BALANCE_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="adm-balances-filters-card__primary-actions">
            <button
              type="button"
              className={[
                "adm-btn adm-btn--ghost adm-btn--xs adm-balances-advanced-toggle",
                !filterOpen && advancedFilterCount > 0 ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((v) => !v)}
            >
              {filterOpen ? (
                <>
                  <X size={16} strokeWidth={1.75} aria-hidden /> סגור סינון מתקדם
                </>
              ) : (
                <>
                  <Search size={16} strokeWidth={1.75} aria-hidden /> סינון מתקדם
                  {advancedFilterCount > 0 ? ` • ${advancedFilterCount}` : ""}
                </>
              )}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearPageFilters}>
              נקה
            </button>
          </div>
        </div>
        {advancedFiltersPanel}
      </div>

      {newDataAvailable ? (
        <div className="adm-balances-new-data-banner" role="status" dir="rtl">
          <span>נמצאו נתונים חדשים בדוח</span>
          <button
            type="button"
            className="adm-btn adm-btn--secondary adm-btn--xs"
            disabled={manualRefreshBusy || tableLoading}
            onClick={() => {
              if (manualRefreshBusy || tableLoading) return;
              softRefreshBalances();
            }}
          >
            רענן עכשיו
          </button>
        </div>
      ) : null}

      {stats ? (
        <section className="adm-balances-fcc-kpi" dir="rtl" aria-label="סיכום פיננסי">
          <article className="adm-balances-fcc-kpi__card">
            <span className="adm-balances-fcc-kpi__label">סה״כ לקוחות</span>
            <strong className="adm-balances-fcc-kpi__value">{(displayPayload?.totalRows ?? 0).toLocaleString("he-IL")}</strong>
          </article>
          <article className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--before-commission">
            <span className="adm-balances-fcc-kpi__label">סה״כ לפני עמלה</span>
            <strong className="adm-balances-fcc-kpi__value" dir="ltr">
              {usdStatDisplay(stats.totalOrdersBeforeCommissionUsd)}
            </strong>
          </article>
          <article className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--after-commission">
            <span className="adm-balances-fcc-kpi__label">סה״כ אחרי עמלה</span>
            <strong className="adm-balances-fcc-kpi__value" dir="ltr">
              {usdStatDisplay(stats.totalOrdersAfterCommissionUsd)}
            </strong>
          </article>
          <article className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--code-withdrawal">
            <span className="adm-balances-fcc-kpi__label">סה״כ משיכה מקוד</span>
            <strong className="adm-balances-fcc-kpi__value" dir="ltr">
              {usdStatDisplay(stats.totalCodeWithdrawalUsd)}
            </strong>
          </article>
          <article className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--payments">
            <span className="adm-balances-fcc-kpi__label">סה״כ תשלומים</span>
            <strong className="adm-balances-fcc-kpi__value" dir="ltr">
              {usdStatDisplay(stats.totalPaymentsUsd)}
            </strong>
          </article>
          <article className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--balance">
            <span className="adm-balances-fcc-kpi__label">סה״כ יתרות</span>
            <strong className="adm-balances-fcc-kpi__value" dir="ltr">
              {usdStatDisplay(stats.totalNetBalanceUsd)}
            </strong>
          </article>
        </section>
      ) : (
        <section className="adm-balances-fcc-kpi adm-balances-fcc-kpi--skeleton" dir="rtl" aria-busy="true" aria-label="טוען סיכום">
          {["לקוחות", "לפני עמלה", "אחרי עמלה", "משיכה מקוד", "תשלומים", "יתרות"].map((label) => (
            <article key={label} className="adm-balances-fcc-kpi__card adm-balances-fcc-kpi__card--skel">
              <span className="adm-balances-fcc-kpi__label">{label}</span>
              <strong className="adm-balances-fcc-kpi__value">—</strong>
            </article>
          ))}
        </section>
      )}

      <div className="adm-balances-work">
        {balancesScopeSubtitle(
          balancesFilters.weekCode,
          balancesFilters.toYmd,
          balancesFilters.rangeFromYmd,
          balancesFilters.rangeToYmd,
        ) ? (
          <p className="adm-balances-scope-line" role="note">
            {balancesScopeSubtitle(
              balancesFilters.weekCode,
              balancesFilters.toYmd,
              balancesFilters.rangeFromYmd,
              balancesFilters.rangeToYmd,
            )}
          </p>
        ) : null}
        {displayPayload?.activeOrderStatusFilter && displayPayload.activeOrderStatusFilter !== "ALL" ? (
          <p className="adm-balances-scope-line adm-balances-scope-line--filter" role="note">
            חישוב יתרה לפי הזמנות בסטטוס «
            {CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS.find((o) => o.value === displayPayload.activeOrderStatusFilter)?.label}» ·
            תשלומים לפי כל ההזמנות בטווח
          </p>
        ) : null}

        {stats && insightsExpanded ? (
          <CustomerBalancesInsightsBar
            stats={stats}
            rows={displayPayload?.rows ?? []}
            totalRows={displayPayload?.totalRows ?? 0}
            totalPages={displayPayload?.totalPages ?? 1}
            expanded={insightsExpanded}
          />
        ) : null}

        {refreshing || (payload && !queryMatchesView) ? (
          <p className="adm-balances-refresh-hint" role="status">
            מרענן...
          </p>
        ) : null}

        <div
          className={[
            "adm-balances-table-wrap",
            refreshing ? "adm-balances-table-wrap--loading" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-busy={tableLoading}
        >
          {refreshing ? (
            <div className="adm-balances-table-overlay" role="status" aria-label="מרענן נתונים">
              <span className="adm-balances-table-spinner" />
            </div>
          ) : null}
          <table className="adm-table adm-table--excel adm-balances-table adm-balances-table--erp adm-balances-table--focus">
            <thead>
              <tr>
                <th className="adm-balances-th-code">קוד לקוח</th>
                <th className="adm-balances-th-name">שם לקוח</th>
                <th className="adm-balances-th-num adm-balances-th-num--before">לפני עמלה ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--including">אחרי עמלה ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--withdrawal">משיכה מקוד ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--payments">תשלומים ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--commission">עמלות ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--balance">חוב פתוח ($)</th>
                <th className="adm-balances-th-num adm-balances-th-num--credit">יתרת זכות ($)</th>
                <th className="adm-balances-th-status">מצב חשבון</th>
                <th className="adm-balances-th-actions">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {tableBusy && !displayPayload ? (
                <TableSkeleton rows={10} columns={colCount} />
              ) : err && !displayPayload ? (
                <tr>
                  <td colSpan={colCount}>לא ניתן להציג יתרות — נסו שוב</td>
                </tr>
              ) : displayPayload && displayPayload.rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>אין תוצאות</td>
                </tr>
              ) : (
                displayPayload?.rows.map((r) => {
                  const ui = balanceUiFromRow(r);
                  const ordersUsd = rowOrdersUsdSplit(r);
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
                      <td className="adm-balances-td-code" dir="ltr">
                        {r.customerCode ?? "—"}
                      </td>
                      <td className="adm-balances-td-name">{r.customerName}</td>
                      <td className="adm-balances-td-num adm-balances-td-num--before" dir="ltr">
                        {formatUsdDisplay(ordersUsd.beforeUsd)}
                      </td>
                      <td className="adm-balances-td-num adm-balances-td-num--including" dir="ltr">
                        {formatUsdDisplay(ordersUsd.includingUsd)}
                      </td>
                      <td className="adm-balances-td-num adm-balances-td-num--withdrawal" dir="ltr">
                        {formatUsdDisplay(ordersUsd.withdrawalUsd)}
                      </td>
                      <td className="adm-balances-td-num adm-balances-td-num--payments" dir="ltr">
                        {moneyUsdCell(r.totalPaymentsUSD)}
                      </td>
                      <td
                        className="adm-balances-td-num adm-balances-td-num--commission"
                        dir="ltr"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <CommissionAmountButton
                          amountUsd={parseMoneyStringOrZero(r.commissionBalanceUSD)}
                          onClick={() =>
                            setCommissionDetailCustomer({
                              customerId: r.customerId,
                              customerName: r.customerName,
                              commissionUsd: parseMoneyStringOrZero(r.commissionBalanceUSD),
                            })
                          }
                        />
                      </td>
                      <td
                        className={`adm-balances-td-num adm-balances-td-num--hero ${
                          parseMoneyStringOrZero(r.totalBalanceUSD) > 0.01
                            ? "adm-bal-amt--debt"
                            : "adm-bal-amt--balanced"
                        }`}
                        dir="ltr"
                      >
                        <span className="adm-balances-hero-usd">
                          {formatUsdDisplay(parseMoneyStringOrZero(r.totalBalanceUSD))}
                        </span>
                        <UsdBalanceIlsGrossText
                          usd={parseMoneyStringOrZero(r.totalBalanceUSD)}
                          exchangeRate={exchangeRate}
                          className="adm-balances-ils-gross"
                        />
                      </td>
                      <td
                        className={`adm-balances-td-num adm-balances-td-num--credit ${
                          parseMoneyStringOrZero(r.availableCreditUSD ?? "0") > 0.01
                            ? "adm-bal-amt--credit"
                            : "adm-bal-amt--balanced"
                        }`}
                        dir="ltr"
                      >
                        {formatUsdDisplay(parseMoneyStringOrZero(r.availableCreditUSD ?? "0"))}
                      </td>
                      <td className="adm-balances-td-status">
                        <span className={statusChipClass(ui.tone)}>{ui.label}</span>
                      </td>
                      <td className="adm-balances-td-actions">
                        <div className="adm-balances-row-actions">
                          <button
                            type="button"
                            className="adm-btn adm-btn--ghost adm-btn--xs adm-balances-ledger-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCustomerCard(r);
                            }}
                          >
                            <BookOpen size={14} strokeWidth={2.2} aria-hidden />
                            כרטסת
                          </button>
                          {canResetViaCommissions && (ui.tone === "debt" || ui.tone === "credit") ? (
                            <button
                              type="button"
                              className="adm-btn adm-btn--ghost adm-btn--xs adm-balances-ledger-btn adm-balances-commission-reset-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCommissionResetRow(r);
                              }}
                            >
                              <Coins size={14} strokeWidth={2.2} aria-hidden />
                              איפוס
                            </button>
                          ) : null}
                        </div>
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
                  <span>חוב פתוח</span>{" "}
                  <span dir="ltr">{formatUsdDisplay(parseMoneyStringOrZero(hoverRow?.totalBalanceUSD ?? "0"))}</span>
                  <span className="adm-balances-preview-sep">·</span>
                  <span>יתרת זכות</span>{" "}
                  <span dir="ltr">{formatUsdDisplay(parseMoneyStringOrZero(hoverRow?.availableCreditUSD ?? "0"))}</span>
                </p>
                <p className="adm-balances-preview-meta">{preview.lastPaymentLabel}</p>
              </>
            ) : null}
          </div>
        ) : null}

        <footer className="adm-balances-foot">
          <span className="adm-balances-page-meta">{displayPayload?.totalRows ?? 0} לקוחות</span>
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
                className={n === (displayPayload?.page ?? page) ? "adm-btn adm-btn--xs adm-btn--primary" : "adm-btn adm-btn--ghost adm-btn--xs"}
                disabled={tableBusy}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--xs"
              disabled={!displayPayload || page >= (displayPayload?.totalPages ?? 1) || tableBusy}
              onClick={() => setPage((p) => p + 1)}
            >
              הבא
            </button>
          </nav>
        </footer>
      </div>

      <CustomerCommissionResetModal
        open={commissionResetRow != null}
        customerId={commissionResetRow?.customerId ?? null}
        customerName={commissionResetRow?.customerName ?? ""}
        onClose={() => setCommissionResetRow(null)}
        onSuccess={(msg) => {
          showToast(msg);
          if (commissionResetRow?.customerId) {
            invalidateCustomerCardSnapshotClient(commissionResetRow.customerId);
          }
          window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
        }}
      />
      <CommissionBalancePopover
        open={commissionDetailCustomer != null}
        customerId={commissionDetailCustomer?.customerId ?? null}
        customerLabel={commissionDetailCustomer?.customerName ?? null}
        previewBalanceUsd={commissionDetailCustomer?.commissionUsd ?? null}
        onClose={() => setCommissionDetailCustomer(null)}
        onOpenOrderDetail={(orderId, orderNumber) => {
          setCommissionDetailCustomer(null);
          setOrderCommissionDetail({ orderId, orderNumber });
        }}
        onOpenPayment={(paymentId) => {
          setCommissionDetailCustomer(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
      <OrderCommissionDetailModal
        open={orderCommissionDetail != null}
        orderId={orderCommissionDetail?.orderId ?? null}
        orderNumber={orderCommissionDetail?.orderNumber}
        onClose={() => setOrderCommissionDetail(null)}
        onOpenPayment={(paymentId) => {
          setOrderCommissionDetail(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />

      {toastMsg ? (
        <div className="adm-toast adm-toast--success" role="status" aria-live="polite">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}
