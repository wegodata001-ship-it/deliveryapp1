"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportOrdersSourceAction,
  getOrderSourcePreviewAction,
  listOrdersSourceTableAction,
  updateOrderStatusSourceAction,
  type OrdersSourceListPayload,
} from "@/app/admin/source-tables/orders-actions";
import type { OrdersSourcePreview, OrderSourceRowTone } from "@/lib/orders-source-table";
import { ORDER_COUNTRY_CODES, orderCountryLabel } from "@/lib/order-countries";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;

type AdvancedFilters = {
  orderNumber: string;
  customer: string;
  country: string;
  weekCode: string;
  status: string;
  fromYmd: string;
  toYmd: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  orderNumber: "",
  customer: "",
  country: "",
  weekCode: "",
  status: "",
  fromYmd: "",
  toYmd: "",
};

function statusToneClass(tone: OrderSourceRowTone): string {
  switch (tone) {
    case "new":
      return "adm-orders-source-status--new";
    case "progress":
      return "adm-orders-source-status--progress";
    case "done":
      return "adm-orders-source-status--done";
    case "cancelled":
      return "adm-orders-source-status--cancelled";
    default:
      return "adm-orders-source-status--neutral";
  }
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

export function OrdersSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { globalCountry } = useAdminGlobal();
  const workCountry = workCountryFromOrderSourceCountry(globalCountry);
  const { openWindow } = useAdminWindows();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [payload, setPayload] = useState<OrdersSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrdersSourcePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
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
        orderNumber: filters.orderNumber || undefined,
        customer: filters.customer || undefined,
        country: filters.country || undefined,
        weekCode: filters.weekCode || undefined,
        status: filters.status || undefined,
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
    void listOrdersSourceTableAction(buildQuery(page))
      .then((next) => {
        if (fetchGen.current !== seq) return;
        setPayload(next);
        if (page > 1 && next.rows.length === 0) setPage(1);
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת הזמנות");
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

  const schedulePreview = useCallback((orderId: string | null) => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!orderId) {
      hoverIdRef.current = null;
      setHoverId(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = orderId;
    setHoverId(orderId);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getOrderSourcePreviewAction(orderId)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== orderId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportOrdersSourceAction(buildQuery(1), kind);
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

  async function onStatusChange(orderId: string, statusId: string) {
    setStatusBusyId(orderId);
    const res = await updateOrderStatusSourceAction(orderId, statusId);
    setStatusBusyId(null);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setPayload((prev) => {
      if (!prev) return prev;
      const opt = prev.statusOptions.find((o) => o.value === statusId);
      return {
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === orderId
            ? {
                ...r,
                statusId,
                statusLabel: opt?.label ?? statusId,
                tone:
                  statusId === "COMPLETED"
                    ? "done"
                    : statusId === "CANCELLED"
                      ? "cancelled"
                      : statusId === "OPEN"
                        ? "new"
                        : statusId.startsWith("WAITING") || statusId === "SENT"
                          ? "progress"
                          : "neutral",
              }
            : r,
        ),
      };
    });
  }

  const kpis = payload?.kpis;
  const rows = payload?.rows ?? [];
  const hasMore = payload?.hasMore ?? false;
  const statusOptions = payload?.statusOptions ?? [];

  return (
    <div className="adm-source-pro adm-orders-source">
      {kpis ? (
        <div className="adm-orders-source-kpi-row" dir="rtl">
          <div className="adm-orders-source-kpi-card">
            <span className="adm-orders-source-kpi-lbl">📦 סה״כ הזמנות</span>
            <strong>{kpis.totalOrders.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-orders-source-kpi-card">
            <span className="adm-orders-source-kpi-lbl">💰 סכום כולל (USD)</span>
            <strong dir="ltr">${kpis.totalUsd}</strong>
          </div>
          <div className="adm-orders-source-kpi-card">
            <span className="adm-orders-source-kpi-lbl">🌍 מדינות פעילות</span>
            <strong>{kpis.activeCountries.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-orders-source-kpi-card">
            <span className="adm-orders-source-kpi-lbl">📅 הזמנות השבוע ({kpis.weekCode})</span>
            <strong>{kpis.weekOrders.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש מהיר: מספר, לקוח, שבוע…"
          disabled={loading && !payload}
        />
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setFilterOpen((v) => !v)}>
          סינון מתקדם 🔍
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("pdf")}
        >
          {exportBusy === "pdf" ? "…" : "📄 Export PDF"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--ghost"
          disabled={!!exportBusy || loading}
          onClick={() => void runExport("excel")}
        >
          {exportBusy === "excel" ? "…" : "📊 Export Excel"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={() => runFetch()} disabled={loading}>
          רענון
        </button>
      </div>

      {filterOpen ? (
        <div className="adm-source-pro-filters adm-orders-source-advanced-filters">
          <label>
            מספר הזמנה
            <input
              value={filters.orderNumber}
              onChange={(e) => setFilters((f) => ({ ...f, orderNumber: e.target.value }))}
              dir="ltr"
            />
          </label>
          <label>
            לקוח
            <input value={filters.customer} onChange={(e) => setFilters((f) => ({ ...f, customer: e.target.value }))} />
          </label>
          <label>
            מדינה
            <select value={filters.country} onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}>
              <option value="">הכל</option>
              {ORDER_COUNTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {orderCountryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            שבוע
            <input
              value={filters.weekCode}
              onChange={(e) => setFilters((f) => ({ ...f, weekCode: e.target.value }))}
              dir="ltr"
              placeholder="2026-W21"
            />
          </label>
          <label>
            סטטוס
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">הכל</option>
              {statusOptions.map((o) => (
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

      <div className={["adm-source-pro-table-wrap", "adm-dt-wrap", loading ? "adm-dt-wrap--busy" : ""].filter(Boolean).join(" ")}>
        <table className="adm-table adm-source-pro-table adm-orders-source-table">
          <thead>
            <tr>
              {[
                { key: "order", label: "מספר הזמנה", sortable: true },
                { key: "week", label: "שבוע", sortable: true },
                { key: "customer", label: "לקוח", sortable: true },
                { key: "country", label: "מדינה", sortable: true },
                { key: "date", label: "תאריך", sortable: true },
                { key: "usd", label: "דולר", sortable: true },
                { key: "ils", label: 'שקל כולל מע"מ', sortable: true },
                { key: "payment", label: "תשלום", sortable: false },
                { key: "status", label: "סטטוס", sortable: true },
              ].map((col) => (
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
            <TableSkeleton columnCount={9} rowCount={8} />
          ) : (
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <TableEmpty />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="adm-source-pro-row adm-orders-source-row"
                    onMouseEnter={() => schedulePreview(r.id)}
                    onMouseLeave={() => schedulePreview(null)}
                    onDoubleClick={() =>
                      openWindow({ type: "orderCapture", props: { mode: "edit", orderId: r.id } })
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="adm-source-primary-link"
                        dir="ltr"
                        onClick={() =>
                          openWindow({ type: "orderCapture", props: { mode: "edit", orderId: r.id } })
                        }
                      >
                        {r.orderNumber}
                      </button>
                    </td>
                    <td dir="ltr">{r.weekCode}</td>
                    <td>{r.customerName}</td>
                    <td>{r.country}</td>
                    <td dir="ltr">{r.orderDateYmd}</td>
                    <td dir="ltr">{r.usd}</td>
                    <td dir="ltr">{r.ils}</td>
                    <td>{r.paymentLabel}</td>
                    <td>
                      <select
                        className={["adm-orders-source-status-sel", statusToneClass(r.tone)].join(" ")}
                        value={r.statusId}
                        disabled={statusBusyId === r.id}
                        onChange={(e) => void onStatusChange(r.id, e.target.value)}
                        aria-label={`סטטוס ${r.orderNumber}`}
                      >
                        {statusOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          )}
        </table>
      </div>

      {hoverId && (preview || previewBusy) ? (
        <div className="adm-orders-source-preview-popover" role="tooltip" dir="rtl">
          {previewBusy && !preview ? (
            <p className="adm-orders-source-preview-meta">טוען…</p>
          ) : preview ? (
            <>
              <p>
                <strong dir="ltr">{preview.orderNumber}</strong>
              </p>
              <p>
                <span>לקוח</span> {preview.customerName}
              </p>
              <p>
                <span>מדינה</span> {preview.country}
              </p>
              <p>
                <span>תאריך</span> <span dir="ltr">{preview.orderDateYmd}</span>
              </p>
              <p>
                <span>סכום</span>{" "}
                <span dir="ltr">
                  ${preview.usd} · ₪{preview.ils}
                </span>
              </p>
              <p>
                <span>סטטוס</span> {preview.statusLabel}
              </p>
              <p>
                <span>תשלום</span> {preview.paymentMethod}
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
