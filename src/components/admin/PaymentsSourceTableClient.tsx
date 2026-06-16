"use client";

import { PaymentMethod } from "@prisma/client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  exportPaymentsSourceAction,
  getPaymentCaptureAllocationsAction,
  getPaymentSourcePreviewAction,
  listPaymentsSourceTableAction,
  type PaymentsSourceListPayload,
} from "@/app/admin/source-tables/payments-actions";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentCaptureAllocationRow,
  type PaymentMethodTone,
  type PaymentsSourcePreview,
} from "@/lib/payments-source-shared";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import { prefetchPaymentEntryClient } from "@/lib/payment-entry-client";
import { BadgeDollarSign, CalendarDays, DollarSign, FileSpreadsheet, FileText, Search } from "lucide-react";

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;
const AMOUNT_HIGHLIGHT = 1000;

type AdvancedFilters = {
  paymentCode: string;
  customerCode: string;
  customerName: string;
  paymentMethod: string;
  fromYmd: string;
  toYmd: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  paymentCode: "",
  customerCode: "",
  customerName: "",
  paymentMethod: "",
  fromYmd: "",
  toYmd: "",
};

const METHOD_FILTER_OPTIONS = Object.values(PaymentMethod).map((m) => ({
  value: m,
  label: PAYMENT_METHOD_LABELS[m] ?? m,
}));

function methodBadgeClass(tone: PaymentMethodTone): string {
  return `adm-payments-method-badge adm-payments-method-badge--${tone}`;
}

function amountClass(n: number): string {
  const base = "adm-payments-amt";
  return Math.abs(n) >= AMOUNT_HIGHLIGHT ? `${base} ${base}--high` : base;
}

function formatPaymentDateDisplay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAllocationLine(row: PaymentCaptureAllocationRow): string {
  return `${row.orderNumber}   ${fmtUsd(row.orderTotalUsd)} → שולם ${fmtUsd(row.paidUsd)} → נשאר ${fmtUsd(row.remainingUsd)}`;
}

const TABLE_COLUMNS = [
  { key: "code", label: "מספר תשלום", sortable: true },
  { key: "date", label: "תאריך", sortable: true },
  { key: "customer", label: "לקוח", sortable: true },
  { key: "total", label: 'סה"כ תשלום', sortable: true },
  { key: "ils", label: "שקלים", sortable: true },
  { key: "usd", label: "דולרים", sortable: true },
  { key: "method", label: "אמצעי תשלום", sortable: true },
  { key: "status", label: "סטטוס", sortable: true },
  { key: "actions", label: "פעולות", sortable: false },
] as const;

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

export function PaymentsSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const { openWindow } = useAdminWindows();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [payload, setPayload] = useState<PaymentsSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [hoverCustomerId, setHoverCustomerId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PaymentsSourcePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [allocationsByPaymentId, setAllocationsByPaymentId] = useState<
    Record<string, PaymentCaptureAllocationRow[]>
  >({});
  const [allocationsLoadingId, setAllocationsLoadingId] = useState<string | null>(null);
  const fetchGen = useRef(0);
  const previewGen = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(
    (p: number) => ({
      page: p,
      limit: PAGE_LIMIT,
      workCountry,
      search: debouncedSearch,
      sortKey,
      sortDir,
      filters: {
        search: debouncedSearch || undefined,
        paymentCode: filters.paymentCode || undefined,
        customerCode: filters.customerCode || undefined,
        customerName: filters.customerName || undefined,
        paymentMethod: filters.paymentMethod || undefined,
        fromYmd: filters.fromYmd || undefined,
        toYmd: filters.toYmd || undefined,
      },
    }),
    [debouncedSearch, sortKey, sortDir, filters, workCountry],
  );

  const runFetch = useCallback(() => {
    const seq = ++fetchGen.current;
    setLoading(true);
    setLoadError(null);
    void listPaymentsSourceTableAction(buildQuery(page))
      .then((next) => {
        if (fetchGen.current !== seq) return;
        setPayload(next);
        if (page > 1 && next.rows.length === 0) setPage(1);
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת תשלומים");
      })
      .finally(() => {
        if (fetchGen.current !== seq) return;
        setLoading(false);
      });
  }, [page, buildQuery]);

  useEffect(() => {
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters, sortKey, sortDir]);

  const schedulePreview = useCallback((customerId: string | null) => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!customerId) {
      hoverIdRef.current = null;
      setHoverCustomerId(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = customerId;
    setHoverCustomerId(customerId);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getPaymentSourcePreviewAction(customerId)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== customerId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  const openPayment = useCallback(
    (paymentId: string) => {
      openWindow({ type: "paymentsUpdated", props: { paymentId } });
    },
    [openWindow],
  );

  const prefetchPaymentOpen = useCallback((paymentId: string) => {
    prefetchPaymentEntryClient(paymentId);
  }, []);

  const loadAllocations = useCallback(async (paymentId: string) => {
    const id = paymentId.trim();
    if (!id || allocationsByPaymentId[id]) return;
    setAllocationsLoadingId(id);
    try {
      const rows = await getPaymentCaptureAllocationsAction(id);
      setAllocationsByPaymentId((prev) => ({ ...prev, [id]: rows }));
    } finally {
      setAllocationsLoadingId((cur) => (cur === id ? null : cur));
    }
  }, [allocationsByPaymentId]);

  const toggleExpanded = useCallback(
    (paymentId: string, allocationCount: number) => {
      const id = paymentId.trim();
      if (!id) return;
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        next.add(id);
        return next;
      });
      if (allocationCount > 0) void loadAllocations(id);
    },
    [loadAllocations],
  );

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportPaymentsSourceAction(buildQuery(1), kind);
    setExportBusy(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    if (kind === "pdf" && res.mime.startsWith("text/html")) {
      openPdfHtml(res.base64);
    } else {
      downloadBase64(res.base64, res.filename, res.mime);
    }
  }

  const kpis = payload?.kpis;
  const rows = payload?.rows ?? [];
  const hasMore = payload?.hasMore ?? false;

  return (
    <div className="adm-source-pro adm-payments-source">
      {kpis ? (
        <div className="adm-payments-source-kpi-row" dir="rtl">
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl"><BadgeDollarSign size={16} strokeWidth={1.75} aria-hidden /> סה״כ תשלומים</span>
            <strong>{kpis.totalPayments.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl"><DollarSign size={16} strokeWidth={1.75} aria-hidden /> סה״כ דולר</span>
            <strong dir="ltr">${kpis.totalUsd}</strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl">₪ סה״כ שקלים</span>
            <strong dir="ltr">₪{kpis.totalIls}</strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl"><CalendarDays size={16} strokeWidth={1.75} aria-hidden /> תשלומים השבוע ({kpis.weekCode})</span>
            <strong>{kpis.weekPayments.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky adm-payments-source-toolbar">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש מהיר: מספר תשלום, לקוח, שבוע…"
          disabled={loading && !payload}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          {filterOpen ? "הסתר סינון" : <><Search size={16} strokeWidth={1.75} aria-hidden /> סינון</>}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("pdf")}
        >
          {exportBusy === "pdf" ? "…" : <><FileText size={16} strokeWidth={1.75} aria-hidden /> PDF</>}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("excel")}
        >
          {exportBusy === "excel" ? "…" : <><FileSpreadsheet size={16} strokeWidth={1.75} aria-hidden /> Excel</>}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => runFetch()} disabled={loading}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters adm-payments-source-advanced-filters" dir="rtl">
          <label>
            מספר תשלום
            <input
              value={filters.paymentCode}
              onChange={(e) => setFilters((f) => ({ ...f, paymentCode: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label>
            קוד לקוח
            <input
              value={filters.customerCode}
              onChange={(e) => setFilters((f) => ({ ...f, customerCode: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label>
            שם לקוח
            <input
              value={filters.customerName}
              onChange={(e) => setFilters((f) => ({ ...f, customerName: e.target.value }))}
            />
          </label>
          <label>
            אמצעי תשלום
            <select
              value={filters.paymentMethod}
              onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value }))}
            >
              <option value="">הכל</option>
              {METHOD_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            תאריך מ-
            <input type="date" value={filters.fromYmd} onChange={(e) => setFilters((f) => ({ ...f, fromYmd: e.target.value }))} />
          </label>
          <label>
            עד
            <input type="date" value={filters.toYmd} onChange={(e) => setFilters((f) => ({ ...f, toYmd: e.target.value }))} />
          </label>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            נקה סינון
          </button>
        </div>
      ) : null}

      {loadError ? <TableError message={loadError} onRetry={() => runFetch()} /> : null}

      <div className={["adm-payments-source-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        <table className="adm-table adm-payments-source-table">
          <thead>
            <tr>
              {TABLE_COLUMNS.map((col) => (
                <th key={col.key}>
                  {col.sortable ? (
                    <button
                      type="button"
                      className="adm-source-sort-btn"
                      disabled={loading}
                      onClick={() => {
                        setSortKey(col.key);
                        setSortDir((d) => (sortKey === col.key && d === "asc" ? "desc" : "asc"));
                      }}
                    >
                      {col.label}
                      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {loading && !payload ? (
            <TableSkeleton columnCount={TABLE_COLUMNS.length} rowCount={10} />
          ) : (
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLUMNS.length}>
                    <TableEmpty />
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const expanded = expandedIds.has(r.id);
                  const canExpand = r.allocationCount > 0;
                  const allocations = allocationsByPaymentId[r.id];
                  const allocBusy = allocationsLoadingId === r.id;

                  return (
                    <Fragment key={r.id}>
                      <tr
                        className={[
                          "adm-payments-source-row",
                          r.status === "CANCELLED" ? "adm-payments-source-row--cancelled" : "",
                          expanded ? "adm-payments-source-row--expanded" : "",
                          canExpand ? "adm-payments-source-row--expandable" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onMouseEnter={() => {
                          prefetchPaymentOpen(r.id);
                          if (r.customerId) schedulePreview(r.customerId);
                        }}
                        onMouseLeave={() => schedulePreview(null)}
                        onClick={() => {
                          if (canExpand) toggleExpanded(r.id, r.allocationCount);
                        }}
                        onKeyDown={(e) => {
                          if (!canExpand) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpanded(r.id, r.allocationCount);
                          }
                        }}
                        tabIndex={canExpand ? 0 : -1}
                        role={canExpand ? "button" : undefined}
                        aria-expanded={canExpand ? expanded : undefined}
                      >
                        <td className="adm-payments-td-code">
                          <div className="adm-payments-code-cell">
                            {canExpand ? (
                              <span
                                className={[
                                  "adm-payments-expand-btn",
                                  expanded ? "adm-payments-expand-btn--open" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                aria-hidden
                              >
                                ▼
                              </span>
                            ) : (
                              <span className="adm-payments-expand-btn adm-payments-expand-btn--spacer" aria-hidden />
                            )}
                            <button
                              type="button"
                              className="adm-source-primary-link adm-payments-code-link"
                              dir="ltr"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPayment(r.id);
                              }}
                            >
                              {r.paymentCode}
                            </button>
                          </div>
                        </td>
                        <td className="adm-payments-td-date" dir="ltr">
                          {formatPaymentDateDisplay(r.paymentDateYmd)}
                        </td>
                        <td className="adm-payments-td-customer">{r.customerName}</td>
                        <td className="adm-payments-td-amt">
                          <span dir="ltr" className={amountClass(r.totalUsdNum)}>
                            {r.totalUsd === "—" ? "—" : `$${r.totalUsd}`}
                          </span>
                        </td>
                        <td className="adm-payments-td-amt">
                          <span dir="ltr" className={amountClass(r.ilsNum)}>
                            {r.ils === "—" ? "—" : `₪${r.ils}`}
                          </span>
                        </td>
                        <td className="adm-payments-td-amt">
                          <span dir="ltr" className={amountClass(r.usdNum)}>
                            {r.usd === "—" ? "—" : `$${r.usd}`}
                          </span>
                        </td>
                        <td className="adm-payments-td-method">
                          {r.methodLabel === "—" ? (
                            <span className="adm-payments-empty">—</span>
                          ) : (
                            <span className={methodBadgeClass(r.methodTone)}>{r.methodLabel}</span>
                          )}
                        </td>
                        <td className="adm-payments-td-status">
                          <span
                            className={[
                              "adm-payments-status-badge",
                              r.status === "CANCELLED"
                                ? "adm-payments-status-badge--cancelled"
                                : "adm-payments-status-badge--active",
                            ].join(" ")}
                          >
                            {r.statusLabel}
                          </span>
                        </td>
                        <td className="adm-payments-td-actions">
                          <button
                            type="button"
                            className="adm-btn adm-btn--ghost adm-btn--xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPayment(r.id);
                            }}
                          >
                            פתח
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="adm-payments-source-subrow">
                          <td colSpan={TABLE_COLUMNS.length}>
                            <div className="adm-payments-alloc-panel" dir="rtl">
                              {allocBusy && !allocations ? (
                                <p className="adm-payments-alloc-meta">טוען פירוט הזמנות…</p>
                              ) : allocations && allocations.length > 0 ? (
                                <ul className="adm-payments-alloc-list">
                                  {allocations.map((line) => (
                                    <li key={`${r.id}-${line.orderNumber}`} dir="ltr" className="adm-payments-alloc-line">
                                      {formatAllocationLine(line)}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="adm-payments-alloc-meta">אין הקצאות להזמנות בקליטה זו</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          )}
        </table>
      </div>

      {hoverCustomerId && (preview || previewBusy) ? (
        <div className="adm-payments-preview-popover" role="tooltip" dir="rtl">
          {previewBusy && !preview ? (
            <p className="adm-payments-preview-meta">טוען…</p>
          ) : preview ? (
            <>
              <p>
                <strong>{preview.customerName}</strong>
              </p>
              <p>
                <span>קוד</span> <span dir="ltr">{preview.customerCode}</span>
              </p>
              <p>
                <span>טלפון</span> <span dir="ltr">{preview.phone}</span>
              </p>
              <p>
                <span>תשלום אחרון</span> {preview.lastPaymentLabel}
              </p>
              <p>
                <span>הזמנות</span> {preview.ordersCount}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {payload ? (
        <div className="adm-source-pro-pagination">
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            הקודם
          </button>
          <span>
            עמוד {page}
            {hasMore ? "+" : ""}
          </span>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            הבא
          </button>
        </div>
      ) : null}
    </div>
  );
}
