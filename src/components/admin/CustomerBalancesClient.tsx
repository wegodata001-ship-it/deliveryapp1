"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  listCustomerBalancesAction,
  type CustomerBalanceDebtFilter,
  type CustomerBalancePaymentFlow,
  type CustomerBalanceRow,
  type CustomerBalanceSort,
  type CustomerBalancesPayload,
} from "@/app/admin/balances/actions";
import { TableSkeleton } from "@/components/ui/loading";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { formatIlsDisplay, parseMoneyString, parseMoneyStringOrZero } from "@/lib/money-format";
import { withQuery } from "@/lib/admin-url-query";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";

const LIMIT = 15;

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

function dec(value: string): number {
  return parseMoneyStringOrZero(value);
}

function moneyIlsCell(value: string): string {
  return formatIlsDisplay(parseMoneyStringOrZero(value));
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
  const to = (f.toYmd || "").trim();
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) return `יתרות מצטברות · נכון לתאריך ${formatHeDate(to)}`;
  return "יתרות מצטברות · מיום כניסת הלקוח ועד היום";
}

function paymentFlowBadgeClass(flow: CustomerBalancePaymentFlow): string {
  if (flow === "PAID") return "adm-balance-flow adm-balance-flow--paid";
  if (flow === "PARTIAL") return "adm-balance-flow adm-balance-flow--partial";
  if (flow === "NOT_PAID") return "adm-balance-flow adm-balance-flow--none";
  return "adm-balance-flow adm-balance-flow--low";
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
  return {
    weekCode: "",
    uptoWeekCode: "",
    fromYmd: "",
    toYmd: "",
    sourceCountry: "",
    balanceDebtStatus: "ALL",
    sort: "balance_desc",
    currencyView: "",
  };
}

function defaultSearchDraft(): BalancesSearchDraft {
  return { smart: "", minBalanceIls: "", maxBalanceIls: "" };
}

/** תאריך "נכון ל" ומדינה מה־URL */
function parseStructuralFromSearchParams(sp: URLSearchParams): Pick<BalancesFiltersState, "toYmd" | "sourceCountry"> {
  const to = sp.get("to") || "";
  const countryRaw = sp.get("country") || "";
  const country = (ORDER_COUNTRY_CODES.includes(countryRaw as OrderCountryCode) ? countryRaw : "") as OrderCountryCode | "";
  return {
    toYmd: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : "",
    sourceCountry: country,
  };
}

export function CustomerBalancesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [tableLoading, setTableLoading] = useState(false);
  const fetchGenRef = useRef(0);

  const [urlReady, setUrlReady] = useState(false);
  const [balancesFilters, setBalancesFilters] = useState<BalancesFiltersState>(defaultBalancesFilters);
  const [searchDraft, setSearchDraft] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [debouncedSearch, setDebouncedSearch] = useState<BalancesSearchDraft>(defaultSearchDraft);
  const [payload, setPayload] = useState<CustomerBalancesPayload | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
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
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    if (!urlReady) return;
    const gen = ++fetchGenRef.current;
    setTableLoading(true);
    setErr(null);
    void listCustomerBalancesAction({
      page,
      limit: LIMIT,
      lifetime: true,
      toYmd: balancesFilters.toYmd.trim() || undefined,
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
    balancesFilters.toYmd,
    balancesFilters.sourceCountry,
    balancesFilters.balanceDebtStatus,
    balancesFilters.sort,
    balancesFilters.currencyView,
    debouncedSearch.smart,
    debouncedSearch.minBalanceIls,
    debouncedSearch.maxBalanceIls,
  ]);

  const searchPending = searchDraft.smart !== debouncedSearch.smart ||
    searchDraft.minBalanceIls !== debouncedSearch.minBalanceIls ||
    searchDraft.maxBalanceIls !== debouncedSearch.maxBalanceIls;

  const tableBusy = !urlReady || (tableLoading && !payload);

  const applySearchNow = useCallback(() => {
    setDebouncedSearch(searchDraft);
    setPage(1);
  }, [searchDraft]);

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

  function clearPageFilters() {
    setBalancesFilters(defaultBalancesFilters());
    setSearchDraft(defaultSearchDraft());
    setDebouncedSearch(defaultSearchDraft());
    setPage(1);
  }

  const openCustomerCard = useCallback(
    (row: CustomerBalanceRow) => {
      const q = new URLSearchParams({
        customerId: row.customerId,
        tab: "ledger",
      });
      if (row.customerName?.trim()) q.set("name", row.customerName.trim());
      router.push(`/admin/customer-card?${q.toString()}`);
    },
    [router],
  );

  function balanceToneClass(balanceIls: string): string {
    const n = dec(balanceIls);
    if (n > 0.01) return "adm-bal-amt--debt";
    if (n < -0.01) return "adm-bal-amt--credit";
    return "adm-bal-amt--neutral";
  }

  const colCount = 8;

  return (
    <div className="adm-balances-page adm-balances-excel-page">
      <header className="adm-balances-head">
        <h1>יתרות לקוחות</h1>
        <p>דוח יתרות מצטבר — מיום כניסת הלקוח. לחיצה על שם פותחת את כרטסת הלקוח במערכת.</p>
      </header>

      {payload?.stats ? (
        <div className="adm-balances-kpi-strip" dir="rtl">
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
            <span className="adm-balances-kpi-lbl">ללא תשלום</span>
            <span className="adm-balances-kpi-val">{payload.stats.notPaidCount}</span>
          </div>
          <div className="adm-balances-kpi-card">
            <span className="adm-balances-kpi-lbl">שולם חלקית</span>
            <span className="adm-balances-kpi-val">{payload.stats.partialCount}</span>
          </div>
        </div>
      ) : null}

      {err ? <div className="adm-error adm-balances-error">{err}</div> : null}
      {searchPending ? (
        <p className="adm-balances-search-hint" role="status">
          מחפש…
        </p>
      ) : null}

      <div className="adm-balances-filters-bar">
        <div className="adm-balances-filters-bar__inner" dir="rtl">
          <label className="adm-balances-field adm-balances-field--search">
            <span className="adm-balances-field-label">חיפוש</span>
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
              placeholder="לקוח / קוד / טלפון"
              dir="rtl"
              autoComplete="off"
            />
          </label>
          <label className="adm-balances-field adm-balances-field--date">
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
          <label className="adm-balances-field adm-balances-field--country">
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
          <label className="adm-balances-field adm-balances-field--status">
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
          <label className="adm-balances-field adm-balances-field--sort">
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
          <label className="adm-balances-field adm-balances-field--min-bal">
            <span className="adm-balances-field-label">יתרה מינ׳</span>
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
          <label className="adm-balances-field adm-balances-field--max-bal">
            <span className="adm-balances-field-label">יתרה מקס׳</span>
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
          <div className="adm-balances-filters-actions">
            <button type="button" className="adm-balances-filter-btn adm-balances-filter-btn--primary" onClick={applySearchNow}>
              חפש
            </button>
            <button type="button" className="adm-balances-filter-btn adm-balances-filter-btn--ghost" onClick={clearPageFilters}>
              נקה
            </button>
          </div>
        </div>
      </div>

      <div className="adm-balances-work">
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
        <table className="adm-table adm-balances-table adm-balances-table--erp">
          <thead>
            <tr>
              <th className="adm-balances-th-name">שם לקוח</th>
              <th className="adm-balances-th-code">קוד לקוח</th>
              <th className="adm-balances-th-num">סה&quot;כ הזמנות</th>
              <th className="adm-balances-th-num">סה&quot;כ תשלומים</th>
              <th className="adm-balances-th-balance">סה&quot;כ יתרות</th>
              <th className="adm-balances-th-num">סכום עמלות</th>
              <th className="adm-balances-th-num">סכום עסקאות</th>
              <th className="adm-balances-th-num">סכום תקבולים</th>
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
              payload.rows.map((row) => (
                  <tr key={row.customerId} className="adm-balance-row">
                    <td className="adm-balances-td-name">
                      <button
                        type="button"
                        className="adm-balance-link adm-balance-link--customer"
                        onClick={() => openCustomerCard(row)}
                      >
                        {row.customerName}
                      </button>
                    </td>
                    <td className="adm-balances-td-code" dir="ltr">
                      {row.customerCode ?? "—"}
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">{moneyIlsCell(row.totalOrdersILS)}</span>
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">{moneyIlsCell(row.totalPaymentsILS)}</span>
                    </td>
                    <td className={`adm-balances-td-balance ${balanceToneClass(row.totalBalanceILS)}`}>
                      <span dir="ltr" className={`adm-bal-amt ${balanceToneClass(row.totalBalanceILS)}`}>
                        {moneyIlsCell(row.totalBalanceILS)}
                      </span>
                      <span className={`adm-balance-flow ${paymentFlowBadgeClass(row.paymentFlow)}`}>
                        {PAYMENT_FLOW_LABELS[row.paymentFlow]}
                      </span>
                    </td>
                    <td className="adm-balances-td-num">
                      <span dir="ltr">{moneyIlsCell(row.totalCommissionsILS)}</span>
                    </td>
                    <td className="adm-balances-td-num adm-bal-amt--neutral">
                      <span dir="ltr">{moneyIlsCell(row.totalDealsILS)}</span>
                    </td>
                    <td className="adm-balances-td-num adm-bal-amt--credit">
                      <span dir="ltr">{moneyIlsCell(row.totalReceiptsILS)}</span>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-balances-pagination">
        <button
          type="button"
          className="adm-balances-page-btn"
          disabled={tableLoading || (payload?.page ?? page) <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
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
          Next
        </button>
        <span className="adm-balances-page-meta">{payload?.totalRows ?? 0} לקוחות</span>
      </div>
      </div>

    </div>
  );
}
