"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  listCustomerBalancesAction,
  updateCustomerBalanceStatusAction,
  type CustomerBalanceDebtFilter,
  type CustomerBalancePaymentFlow,
  type CustomerBalanceRow,
  type CustomerBalanceSort,
  type CustomerBalancesPayload,
  type CustomerBalanceStatus,
} from "@/app/admin/balances/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { AhWeekNavBar } from "@/components/admin/AhWeekNavButtons";
import { TableSkeleton } from "@/components/ui/loading";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { formatCustomerBalanceDisplay } from "@/lib/customer-balance";
import { formatIlsDisplay, formatUsdDisplay, parseMoneyString, parseMoneyStringOrZero } from "@/lib/money-format";
import { goToNextWeek, goToPrevWeek } from "@/lib/weeks/ah-week-nav";
import { withQuery } from "@/lib/admin-url-query";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  formatLocalYmd,
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  getCurrentWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
} from "@/lib/work-week";

const LIMIT = 15;

const STATUS_LABELS: Record<CustomerBalanceStatus, string> = {
  NOT_PAID: "לא שולם",
  PARTIAL: "שולם חלקית",
  PAID: "שולם במלואו",
  PROBLEM: "חוב בעייתי",
  PAUSED: "מושהה",
};

const DEBT_STATUS_LABELS: Record<CustomerBalanceDebtFilter, string> = {
  ALL: "הכל",
  OWES: "חייב",
  CREDIT: "יתרת זכות",
  PAID_FULL: "שולם במלואו",
  PARTIAL: "שולם חלקית",
  NOT_PAID: "ללא תשלום",
  LOW_BALANCE: "יתרה נמוכה",
};

const PAYMENT_FLOW_LABELS: Record<CustomerBalancePaymentFlow, string> = {
  PAID: "שולם במלואו",
  PARTIAL: "שולם חלקית",
  NOT_PAID: "ללא תשלום",
  LOW_DEBT: "יתרה נמוכה",
};

const SORT_LABELS: Record<CustomerBalanceSort, string> = {
  balance_desc: "יתרה: גבוה → נמוך",
  balance_asc: "יתרה: נמוך → גבוה",
  name: "שם לקוח",
  orders_total: "סה\"כ הזמנות (ש\"ח)",
  week_desc: "שבוע AH: גבוה → נמוך",
  week_asc: "שבוע AH: נמוך → גבוה",
  last_order_desc: "תאריך הזמנה אחרונה: חדש → ישן",
  last_order_asc: "תאריך הזמנה אחרונה: ישן → חדש",
};

function generateWeeks(max = 300): string[] {
  return Array.from({ length: max }, (_, i) => `AH-${i + 1}`);
}

function dec(value: string): number {
  return parseMoneyStringOrZero(value);
}

function moneyIlsCell(value: string): string {
  return formatIlsDisplay(parseMoneyStringOrZero(value));
}

function moneyUsdCell(value: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(value));
}

function renderStoredCreditText(value: string): string {
  const amt = dec(value);
  if (amt <= 0.01) return "—";
  return formatCustomerBalanceDisplay(-amt, "ILS").primaryText;
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

function balancesScopeSubtitle(f: BalancesFiltersState): string | null {
  const upto = normalizeAhWeekCode(f.uptoWeekCode.trim());
  if (upto) return `מציג יתרות עד ${upto}`;
  const to = (f.toYmd || "").trim();
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) return `מציג יתרות עד ${formatHeDate(to)}`;
  const wk = (f.weekCode || "").trim();
  if (wk && wk !== "—") return `מציג יתרות עבור שבוע ${wk}`;
  return null;
}

function paymentFlowBadgeClass(flow: CustomerBalancePaymentFlow): string {
  if (flow === "PAID") return "adm-balance-flow adm-balance-flow--paid";
  if (flow === "PARTIAL") return "adm-balance-flow adm-balance-flow--partial";
  if (flow === "NOT_PAID") return "adm-balance-flow adm-balance-flow--none";
  return "adm-balance-flow adm-balance-flow--low";
}

function rowPaymentFlowHighlight(flow: CustomerBalancePaymentFlow): string {
  if (flow === "PARTIAL") return "adm-balance-tr--flow-partial";
  if (flow === "NOT_PAID") return "adm-balance-tr--flow-none";
  if (flow === "LOW_DEBT") return "adm-balance-tr--flow-low";
  return "";
}

export type BalancesFiltersState = {
  weekCode: string;
  /** צבירה עד סוף שבוע AH (אופציונלי) */
  uptoWeekCode: string;
  fromYmd: string;
  toYmd: string;
  sourceCountry: OrderCountryCode | "";
  balanceDebtStatus: CustomerBalanceDebtFilter;
  sort: CustomerBalanceSort;
  /** סינון תצוגה לפי מטבע חוב (לא משנה חישוב) */
  currencyView: "" | "ILS" | "USD";
};

export type BalancesSearchDraft = {
  smart: string;
  minBalanceIls: string;
  maxBalanceIls: string;
};

function defaultBalancesFilters(): BalancesFiltersState {
  const { start, end } = getCurrentWeekRange(new Date());
  const code = getWeekCodeForLocalDate(start);
  return {
    weekCode: normalizeAhWeekCode(code) ?? DEFAULT_WEEK_CODE,
    uptoWeekCode: "",
    fromYmd: formatLocalYmd(start),
    toYmd: formatLocalYmd(end),
    sourceCountry: "",
    balanceDebtStatus: "ALL",
    sort: "balance_desc",
    currencyView: "",
  };
}

function defaultSearchDraft(): BalancesSearchDraft {
  return { smart: "", minBalanceIls: "", maxBalanceIls: "" };
}

function parseWeekFromUrl(raw: string | null): string | null {
  return normalizeAhWeekCode(raw);
}

/** רק שבוע / תאריכים / מדינה / עד-שבוע מה־URL — לא מחליף חיפוש, מיון או סטטוס יתרה */
function parseStructuralFromSearchParams(sp: URLSearchParams): Pick<BalancesFiltersState, "weekCode" | "uptoWeekCode" | "fromYmd" | "toYmd" | "sourceCountry"> {
  const weekRaw = parseWeekFromUrl(sp.get("week"));
  const uptoRaw = parseWeekFromUrl(sp.get("upto"));
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const countryRaw = sp.get("country") || "";
  const country = (ORDER_COUNTRY_CODES.includes(countryRaw as OrderCountryCode) ? countryRaw : "") as OrderCountryCode | "";

  if (weekRaw) {
    const r = getAhWeekRange(weekRaw);
    if (r) {
      return {
        weekCode: weekRaw,
        uptoWeekCode: uptoRaw ?? "",
        fromYmd: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : r.from,
        toYmd: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : r.to,
        sourceCountry: country,
      };
    }
  }

  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const wk = getAhWeekCodeFromDateRange(from, to);
    return {
      weekCode: wk ?? "—",
      uptoWeekCode: uptoRaw ?? "",
      fromYmd: from,
      toYmd: to,
      sourceCountry: country,
    };
  }

  const d = defaultBalancesFilters();
  return { weekCode: d.weekCode, uptoWeekCode: uptoRaw ?? "", fromYmd: d.fromYmd, toYmd: d.toYmd, sourceCountry: country };
}

export function CustomerBalancesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { openWindow } = useAdminWindows();
  const { runWithLoading } = useAdminLoading();
  const [tableLoading, setTableLoading] = useState(false);
  const fetchGenRef = useRef(0);

  const [urlReady, setUrlReady] = useState(false);
  const [balancesFilters, setBalancesFilters] = useState<BalancesFiltersState>(defaultBalancesFilters);
  const [searchDraft, setSearchDraft] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [debouncedSearch, setDebouncedSearch] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [weekInput, setWeekInput] = useState(() => defaultBalancesFilters().weekCode);
  const [uptoWeekInput, setUptoWeekInput] = useState("");
  const [payload, setPayload] = useState<CustomerBalancesPayload | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const struct = parseStructuralFromSearchParams(new URLSearchParams(sp.toString()));
    setBalancesFilters((f) => ({
      ...f,
      weekCode: struct.weekCode,
      uptoWeekCode: struct.uptoWeekCode,
      fromYmd: struct.fromYmd,
      toYmd: struct.toYmd,
      sourceCountry: struct.sourceCountry,
    }));
    setWeekInput(struct.weekCode === "—" ? "—" : struct.weekCode);
    setUptoWeekInput(struct.uptoWeekCode || "");
    setUrlReady(true);
  }, [sp]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchDraft);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const weekOptions = useMemo(() => {
    const maxKnown = WORK_WEEK_CODES_SORTED.reduce((m, c) => {
      const n = Number(c.replace(/^AH-/i, ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const base = generateWeeks(Math.max(300, maxKnown + 52, 119));
    const merged = new Set([...base, ...WORK_WEEK_CODES_SORTED, weekInput.trim().toUpperCase()]);
    return [...merged].filter(Boolean).sort((a, b) => {
      const na = Number(a.replace(/^AH-/i, "")) || 0;
      const nb = Number(b.replace(/^AH-/i, "")) || 0;
      return na - nb;
    });
  }, [weekInput]);

  const weekCodeForQuery = balancesFilters.weekCode === "—" || !balancesFilters.weekCode.trim() ? undefined : balancesFilters.weekCode.trim();

  useEffect(() => {
    if (!urlReady) return;
    const gen = ++fetchGenRef.current;
    setTableLoading(true);
    setErr(null);
    void listCustomerBalancesAction({
      page,
      limit: LIMIT,
      fromYmd: balancesFilters.fromYmd,
      toYmd: balancesFilters.toYmd,
      weekCode: weekCodeForQuery,
      uptoWeekCode: balancesFilters.uptoWeekCode.trim() || undefined,
      sourceCountry: balancesFilters.sourceCountry,
      filters: {
        smart: debouncedSearch.smart.trim() || undefined,
        minBalanceIls: debouncedSearch.minBalanceIls,
        maxBalanceIls: debouncedSearch.maxBalanceIls,
        balanceDebtStatus: balancesFilters.balanceDebtStatus,
        sort: balancesFilters.sort,
        currencyView: balancesFilters.currencyView || undefined,
      },
    })
      .then((next) => {
        if (gen !== fetchGenRef.current) return;
        setPayload(next);
      })
      .catch(() => {
        if (gen !== fetchGenRef.current) return;
        setErr("טעינת יתרות נכשלה");
      })
      .finally(() => {
        if (gen !== fetchGenRef.current) return;
        setTableLoading(false);
      });
  }, [
    urlReady,
    page,
    balancesFilters.fromYmd,
    balancesFilters.toYmd,
    balancesFilters.uptoWeekCode,
    balancesFilters.sourceCountry,
    balancesFilters.balanceDebtStatus,
    balancesFilters.sort,
    balancesFilters.currencyView,
    debouncedSearch.smart,
    debouncedSearch.minBalanceIls,
    debouncedSearch.maxBalanceIls,
    weekCodeForQuery,
  ]);

  const searchPending = searchDraft.smart !== debouncedSearch.smart ||
    searchDraft.minBalanceIls !== debouncedSearch.minBalanceIls ||
    searchDraft.maxBalanceIls !== debouncedSearch.maxBalanceIls;

  const tableBusy = !urlReady || (tableLoading && !payload);

  const applySearchNow = useCallback(() => {
    setDebouncedSearch(searchDraft);
    setPage(1);
  }, [searchDraft]);

  const navAhWeek = useCallback(
    (delta: -1 | 1) => {
      const base =
        balancesFilters.weekCode === "—" || !balancesFilters.weekCode.trim()
          ? DEFAULT_WEEK_CODE
          : balancesFilters.weekCode;
      const code = delta === -1 ? goToPrevWeek(base) : goToNextWeek(base);
      if (!code) return;
      const r = getAhWeekRange(code);
      if (!r) return;
      setBalancesFilters((f) => ({ ...f, weekCode: code, fromYmd: r.from, toYmd: r.to }));
      setWeekInput(code);
      setPage(1);
    },
    [balancesFilters.weekCode],
  );

  const syncUrl = useCallback(() => {
    if (!urlReady) return;
    const weekQ = balancesFilters.weekCode === "—" ? "" : balancesFilters.weekCode;
    const curWeek = sp.get("week") ?? "";
    const curFrom = sp.get("from") ?? "";
    const curTo = sp.get("to") ?? "";
    const curCountry = sp.get("country") ?? "";
    const nextCountry = balancesFilters.sourceCountry || "";
    const curUpto = sp.get("upto") ?? "";
    const nextUpto = balancesFilters.uptoWeekCode.trim();
    if (
      curWeek === weekQ &&
      curFrom === balancesFilters.fromYmd &&
      curTo === balancesFilters.toYmd &&
      curCountry === nextCountry &&
      curUpto === nextUpto
    ) {
      return;
    }
    const nextHref = withQuery(pathname, sp, {
      week: weekQ,
      upto: nextUpto || null,
      from: balancesFilters.fromYmd,
      to: balancesFilters.toYmd,
      country: nextCountry || null,
      modal: null,
    });
    router.replace(nextHref);
  }, [balancesFilters, pathname, router, sp, urlReady]);

  useEffect(() => {
    syncUrl();
  }, [balancesFilters.fromYmd, balancesFilters.toYmd, balancesFilters.weekCode, balancesFilters.uptoWeekCode, balancesFilters.sourceCountry, syncUrl]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  function setRangeFromWeek(code: string) {
    const r = getAhWeekRange(code);
    if (!r) return;
    setBalancesFilters((f) => ({ ...f, weekCode: code, fromYmd: r.from, toYmd: r.to }));
    setWeekInput(code);
  }

  function onBlurWeekInput() {
    window.setTimeout(() => {
      const normalized = normalizeAhWeekCode(weekInput);
      if (!normalized) {
        setWeekInput(balancesFilters.weekCode === "—" ? "—" : balancesFilters.weekCode);
        return;
      }
      setRangeFromWeek(normalized);
    }, 120);
  }

  function onChangeFromTo(which: "fromYmd" | "toYmd", val: string) {
    setBalancesFilters((f) => {
      const next = { ...f, [which]: val };
      const wk = getAhWeekCodeFromDateRange(next.fromYmd, next.toYmd);
      const nextWeek = wk ?? "—";
      setWeekInput(nextWeek);
      return { ...next, weekCode: nextWeek };
    });
    setPage(1);
  }

  function onBlurUptoWeekInput() {
    window.setTimeout(() => {
      const normalized = normalizeAhWeekCode(uptoWeekInput);
      if (!normalized) {
        setUptoWeekInput(balancesFilters.uptoWeekCode || "");
        return;
      }
      setUptoWeekInput(normalized);
      setBalancesFilters((f) => ({ ...f, uptoWeekCode: normalized }));
      setPage(1);
    }, 120);
  }

  function clearPageFilters() {
    const d = defaultBalancesFilters();
    setBalancesFilters(d);
    setWeekInput(d.weekCode);
    setUptoWeekInput("");
    setSearchDraft(defaultSearchDraft());
    setDebouncedSearch(defaultSearchDraft());
    setPage(1);
  }

  function openLedger(row: CustomerBalanceRow) {
    openWindow({
      type: "customerCard",
      props: { customerId: row.customerId, customerName: row.customerName, initialTab: "ledger" },
    });
  }

  function openPayment(row: CustomerBalanceRow) {
    openWindow({
      type: "paymentsUpdated",
      props: {
        customerId: row.customerId,
        customerName: row.customerName,
        amountIls: row.balanceILS,
      },
    });
  }

  async function changeStatus(row: CustomerBalanceRow, next: CustomerBalanceStatus) {
    if (tableLoading) return;
    setErr(null);
    setPayload((old) =>
      old
        ? {
            ...old,
            rows: old.rows.map((r) =>
              r.customerId === row.customerId ? { ...r, status: next, statusOverride: next } : r,
            ),
          }
        : old,
    );
    const res = await runWithLoading(
      () => updateCustomerBalanceStatusAction(row.customerId, next),
      { message: "שומר סטטוס יתרה...", mode: "overlay" },
    );
    if (!res.ok) {
      setErr(res.error);
      setPage((p) => p);
    }
  }

  const colCount = 10;

  return (
    <div className="adm-balances-page">
      <div className="adm-balances-head">
        <div>
          <h1>יתרת לקוחות</h1>
          <p>תצוגה מודרנית ללקוחות, יתרות וסטטוס גבייה. הפילטרים כאן משפיעים רק על דף זה.</p>
        </div>
      </div>

      {payload?.stats ? (
        <div className="adm-balances-kpi-grid" dir="rtl">
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">סה״כ חייבים (₪)</span>
            <span className="adm-balances-kpi-val" dir="ltr">
              {formatIlsDisplay(parseMoneyStringOrZero(payload.stats.totalDebtIls))}
            </span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">סה״כ זכות (₪)</span>
            <span className="adm-balances-kpi-val" dir="ltr">
              {formatIlsDisplay(parseMoneyStringOrZero(payload.stats.totalCreditIls))}
            </span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">לקוחות עם חוב</span>
            <span className="adm-balances-kpi-val">{payload.stats.withDebtCount}</span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">לקוחות ללא חוב</span>
            <span className="adm-balances-kpi-val">{payload.stats.noDebtCount}</span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">שולם חלקית</span>
            <span className="adm-balances-kpi-val">{payload.stats.partialCount}</span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">ללא תשלום</span>
            <span className="adm-balances-kpi-val">{payload.stats.notPaidCount}</span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">לקוחות עם יתרה גבוהה</span>
            <span className="adm-balances-kpi-val">{payload.stats.highDebtCount}</span>
            <span className="adm-balances-kpi-hint">מעל ‎₪15,000</span>
          </div>
        </div>
      ) : null}

      {err ? <div className="adm-error">{err}</div> : null}
      {searchPending ? (
        <p className="adm-inline-search-hint" role="status">
          מחפש…
        </p>
      ) : null}

      <div className="adm-balances-filters-panel adm-balances-filters-panel--sticky">
        <div className="adm-balances-filters-row adm-balances-filters-row--primary">
          <label className="adm-balances-field adm-balances-field--week-nav">
            <span className="adm-balances-field-label">שבוע AH</span>
            <AhWeekNavBar
              className="adm-balances-week-control"
              buttonClassName="adm-balances-week-step"
              variant="angle"
              onPrev={() => navAhWeek(-1)}
              onNext={() => navAhWeek(1)}
            >
              <input
                className="adm-balances-input adm-balances-input--week"
                type="text"
                list="adm-balances-week-options"
                value={weekInput}
                placeholder={DEFAULT_WEEK_CODE}
                dir="ltr"
                onChange={(e) => setWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurWeekInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <datalist id="adm-balances-week-options">
                {weekOptions.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </AhWeekNavBar>
          </label>
          <label className="adm-balances-field">
            <span className="adm-balances-field-label">מתאריך</span>
            <input
              className="adm-balances-input"
              type="date"
              value={balancesFilters.fromYmd}
              onChange={(e) => onChangeFromTo("fromYmd", e.target.value)}
            />
          </label>
          <label className="adm-balances-field">
            <span className="adm-balances-field-label">עד תאריך</span>
            <input
              className="adm-balances-input"
              type="date"
              value={balancesFilters.toYmd}
              onChange={(e) => onChangeFromTo("toYmd", e.target.value)}
            />
          </label>
          <label className="adm-balances-field">
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
        </div>

        <label className="adm-balances-field adm-balances-field--search-row">
          <span className="adm-balances-field-label">חיפוש לקוח</span>
          <input
            className="adm-balances-input adm-balances-input--search"
            value={searchDraft.smart}
            onChange={(e) => setSearchDraft((s) => ({ ...s, smart: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearchNow();
              }
            }}
            placeholder="חיפוש לקוח / קוד / טלפון"
            dir="rtl"
            autoComplete="off"
          />
        </label>

        <div className="adm-balances-filters-row adm-balances-filters-row--tertiary">
          <div className="adm-balances-filters-tertiary-fields">
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">סטטוס</span>
              <select
                className="adm-balances-input"
                value={balancesFilters.balanceDebtStatus}
                onChange={(e) => {
                  setBalancesFilters((f) => ({ ...f, balanceDebtStatus: e.target.value as CustomerBalanceDebtFilter }));
                  setPage(1);
                }}
              >
                {(Object.keys(DEBT_STATUS_LABELS) as CustomerBalanceDebtFilter[]).map((k) => (
                  <option key={k} value={k}>
                    {DEBT_STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-balances-field">
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
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">מינ׳ יתרה ₪</span>
              <MoneyInput
                className="adm-balances-input"
                placeholder="מינימום"
                value={parseMoneyString(searchDraft.minBalanceIls)}
                onChange={(n) =>
                  setSearchDraft((s) => ({ ...s, minBalanceIls: n == null ? "" : String(n) }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applySearchNow();
                  }
                }}
              />
            </label>
            <label className="adm-balances-field">
              <span className="adm-balances-field-label">מקס׳ יתרה ₪</span>
              <MoneyInput
                className="adm-balances-input"
                placeholder="מקסימום"
                value={parseMoneyString(searchDraft.maxBalanceIls)}
                onChange={(n) =>
                  setSearchDraft((s) => ({ ...s, maxBalanceIls: n == null ? "" : String(n) }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applySearchNow();
                  }
                }}
              />
            </label>
            <label className="adm-balances-field adm-balances-field--upto">
              <span className="adm-balances-field-label">עד שבוע AH (צבירה)</span>
              <input
                className="adm-balances-input"
                type="text"
                list="adm-balances-week-options"
                value={uptoWeekInput}
                placeholder="למשל AH-118"
                dir="ltr"
                onChange={(e) => setUptoWeekInput(e.target.value.toUpperCase())}
                onBlur={onBlurUptoWeekInput}
              />
            </label>
            <label className="adm-balances-field adm-balances-field--currency">
              <span className="adm-balances-field-label">מטבע חוב</span>
              <select
                className="adm-balances-input"
                value={balancesFilters.currencyView}
                onChange={(e) => {
                  setBalancesFilters((f) => ({ ...f, currencyView: e.target.value as "" | "ILS" | "USD" }));
                  setPage(1);
                }}
              >
                <option value="">הכל</option>
                <option value="ILS">חוב בש״ח בלבד</option>
                <option value="USD">חוב בדולר בלבד</option>
              </select>
            </label>
          </div>
          <div className="adm-balances-filters-actions">
            <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={applySearchNow}>
              חפש
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={clearPageFilters}>
              נקה פילטרים
            </button>
          </div>
        </div>
      </div>

      {balancesScopeSubtitle(balancesFilters) ? (
        <p className="adm-balances-scope-line" role="note">
          {balancesScopeSubtitle(balancesFilters)}
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
        <table className="adm-table adm-balances-table">
          <thead>
            <tr>
              <th className="adm-balances-th-name">שם לקוח</th>
              <th className="adm-balances-th-code">קוד לקוח</th>
              <th className="adm-balances-th-num">סה&quot;כ הזמנות</th>
              <th className="adm-balances-th-num">סה&quot;כ תשלומים (קשורים)</th>
              <th className="adm-balances-th-num">סה&quot;כ זיכויים</th>
              <th className="adm-balances-th-balance">יתרה בשקלים</th>
              <th className="adm-balances-th-num">יתרה בדולר</th>
              <th className="adm-balances-th-status">סטטוס</th>
              <th className="adm-balances-th-status">סטטוס גבייה</th>
              <th className="adm-balances-th-actions">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {tableBusy ? (
              <TableSkeleton rows={8} columns={colCount} />
            ) : !payload || payload.rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="adm-table-empty">
                  אין נתונים לטווח שנבחר
                </td>
              </tr>
            ) : (
              payload.rows.map((row) => {
                const canReceivePayment = dec(row.balanceILS) > 0.01;
                const hasCredits = dec(row.totalCreditsILS) > 0;
                return (
                  <tr
                    key={row.customerId}
                    className={[
                      "adm-balance-row",
                      `adm-balance-row--${row.status.toLowerCase()}`,
                      rowPaymentFlowHighlight(row.paymentFlow),
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="adm-balances-td-name">
                      <button type="button" className="adm-balance-link" onClick={() => openLedger(row)}>
                        {row.customerName}
                      </button>
                    </td>
                    <td className="adm-balances-td-code" dir="ltr">
                      {row.customerCode ?? "—"}
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">{moneyIlsCell(row.totalOrdersILS)}</span>
                      <span className="adm-balances-order-count"> ({row.ordersCount})</span>
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">{moneyIlsCell(row.totalPaymentsILS)}</span>
                    </td>
                    <td className="adm-balances-td-num">
                      {hasCredits ? (
                        <CustomerBalanceView businessSigned={-dec(row.totalCreditsILS)} currency="ILS" compact />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="adm-balances-td-balance">
                      <button type="button" className="adm-balance-amount" onClick={() => openPayment(row)} disabled={!canReceivePayment}>
                        {row.noOrdersInRange ? (
                          hasCredits ? (
                            <span className="adm-balance-kind adm-balance-kind--credit">
                              לא קיימות הזמנות בטווח זה · {renderStoredCreditText(row.totalCreditsILS)}
                            </span>
                          ) : (
                            <span className="adm-balance-kind adm-balance-kind--even">לא קיימות הזמנות בטווח זה</span>
                          )
                        ) : (
                          <CustomerBalanceView internalSignedRaw={row.signedIls} currency="ILS" />
                        )}
                      </button>
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">
                        <CustomerBalanceView internalSignedRaw={row.signedUsd} currency="USD" />
                      </span>
                    </td>
                    <td className="adm-balances-td-status">
                      <span className={paymentFlowBadgeClass(row.paymentFlow)}>{PAYMENT_FLOW_LABELS[row.paymentFlow]}</span>
                    </td>
                    <td className="adm-balances-td-status">
                      <select
                        className={`adm-balance-status-select adm-balance-status-select--${row.status.toLowerCase()}`}
                        value={row.status}
                        onChange={(e) => void changeStatus(row, e.target.value as CustomerBalanceStatus)}
                      >
                        {Object.entries(STATUS_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="adm-balances-td-actions">
                      <div className="adm-balance-actions">
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--xs"
                          onClick={() => openLedger(row)}
                          title={`כרטסת: ${row.customerName}`}
                        >
                          כרטסת 📊
                        </button>
                        {canReceivePayment ? (
                          <button
                            type="button"
                            className="adm-btn adm-btn--ghost adm-btn--xs adm-balance-pay-btn"
                            onClick={() => openPayment(row)}
                          >
                            💸 קליטת תשלום
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

      <div className="adm-balances-pagination">
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={tableLoading || (payload?.page ?? page) <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={p === (payload?.page ?? page) ? "adm-page-btn adm-page-btn--active" : "adm-page-btn"}
            onClick={() => !tableLoading && setPage(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={tableLoading || (payload?.page ?? page) >= (payload?.totalPages ?? 1)}
          onClick={() => setPage((p) => Math.min(payload?.totalPages ?? 1, p + 1))}
        >
          Next
        </button>
        <span className="adm-balances-page-meta">{payload?.totalRows ?? 0} לקוחות</span>
      </div>
    </div>
  );
}
