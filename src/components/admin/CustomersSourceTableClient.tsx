"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportCustomersSourceAction,
  getCustomerSourcePreviewAction,
  listCustomersSourceTableAction,
  type CustomersSourceListPayload,
} from "@/app/admin/source-tables/customers-actions";
import type { CustomersSourcePreview } from "@/lib/customers-source-table";
import { WEGO_CUSTOMER_CREATED_EVENT } from "@/lib/customer-created-bus";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;
const PREVIEW_DEBOUNCE_MS = 280;

type AdvancedFilters = {
  code: string;
  name: string;
  phone: string;
  city: string;
  isActive: "" | "true" | "false";
  fromYmd: string;
  toYmd: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  code: "",
  name: "",
  phone: "",
  city: "",
  isActive: "",
  fromYmd: "",
  toYmd: "",
};

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
  const html = new TextDecoder("utf-8").decode(
    Uint8Array.from(bin, (c) => c.charCodeAt(0)),
  );
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

export function CustomersSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { openWindow } = useAdminWindows();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [payload, setPayload] = useState<CustomersSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CustomersSourcePreview | null>(null);
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
      search: debouncedSearch,
      sortKey,
      sortDir,
      filters: {
        search: debouncedSearch || undefined,
        code: filters.code || undefined,
        name: filters.name || undefined,
        phone: filters.phone || undefined,
        city: filters.city || undefined,
        isActive: filters.isActive || undefined,
        fromYmd: filters.fromYmd || undefined,
        toYmd: filters.toYmd || undefined,
      },
    }),
    [debouncedSearch, sortKey, sortDir, filters],
  );

  const runFetch = useCallback(() => {
    const seq = ++fetchGen.current;
    setLoading(true);
    setLoadError(null);
    void listCustomersSourceTableAction(buildQuery(page))
      .then((next) => {
        if (fetchGen.current !== seq) return;
        setPayload(next);
        if (page > 1 && next.rows.length === 0) {
          setPage(1);
        }
      })
      .catch(() => {
        if (fetchGen.current !== seq) return;
        setLoadError("שגיאה בטעינת לקוחות");
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
    const onCustomerCreated = () => {
      setPage(1);
      const seq = ++fetchGen.current;
      setLoading(true);
      setLoadError(null);
      void listCustomersSourceTableAction(buildQuery(1))
        .then((next) => {
          if (fetchGen.current !== seq) return;
          setPayload(next);
        })
        .catch(() => {
          if (fetchGen.current !== seq) return;
          setLoadError("שגיאה בטעינת לקוחות");
        })
        .finally(() => {
          if (fetchGen.current !== seq) return;
          setLoading(false);
        });
    };
    window.addEventListener(WEGO_CUSTOMER_CREATED_EVENT, onCustomerCreated);
    return () => window.removeEventListener(WEGO_CUSTOMER_CREATED_EVENT, onCustomerCreated);
  }, [buildQuery]);

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
      setHoverId(null);
      setPreview(null);
      setPreviewBusy(false);
      return;
    }
    hoverIdRef.current = customerId;
    setHoverId(customerId);
    hoverTimerRef.current = window.setTimeout(() => {
      const seq = ++previewGen.current;
      setPreviewBusy(true);
      void getCustomerSourcePreviewAction(customerId)
        .then((p) => {
          if (previewGen.current !== seq || hoverIdRef.current !== customerId) return;
          setPreview(p);
        })
        .finally(() => {
          if (previewGen.current === seq) setPreviewBusy(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  async function runExport(kind: "pdf" | "excel") {
    setExportBusy(kind);
    const res = await exportCustomersSourceAction(buildQuery(1), kind);
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
    <div className="adm-source-pro adm-customers-source">
      {kpis ? (
        <div className="adm-customers-kpi-row" dir="rtl">
          <div className="adm-customers-kpi-card">
            <span className="adm-customers-kpi-lbl">סה״כ לקוחות</span>
            <strong>{kpis.total.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-customers-kpi-card">
            <span className="adm-customers-kpi-lbl">לקוחות פעילים</span>
            <strong>{kpis.active.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-customers-kpi-card">
            <span className="adm-customers-kpi-lbl">לקוחות עם יתרה</span>
            <strong>{kpis.withBalance.toLocaleString("he-IL")}</strong>
          </div>
          <div className="adm-customers-kpi-card">
            <span className="adm-customers-kpi-lbl">חדשים החודש</span>
            <strong>{kpis.newThisMonth.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש מהיר: שם, קוד, טלפון, עיר…"
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
        <div className="adm-source-pro-filters adm-customers-advanced-filters">
          <label>
            קוד לקוח
            <input value={filters.code} onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value }))} />
          </label>
          <label>
            שם
            <input value={filters.name} onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label>
            טלפון
            <input value={filters.phone} onChange={(e) => setFilters((f) => ({ ...f, phone: e.target.value }))} dir="ltr" />
          </label>
          <label>
            עיר
            <input value={filters.city} onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))} />
          </label>
          <label>
            פעיל
            <select
              value={filters.isActive}
              onChange={(e) => setFilters((f) => ({ ...f, isActive: e.target.value as AdvancedFilters["isActive"] }))}
            >
              <option value="">הכל</option>
              <option value="true">פעיל</option>
              <option value="false">לא פעיל</option>
            </select>
          </label>
          <label>
            הצטרפות מ-
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
        <table className="adm-table adm-source-pro-table adm-customers-source-table">
          <thead>
            <tr>
              {[
                { key: "name", label: "שם", sortable: true },
                { key: "code", label: "קוד", sortable: true },
                { key: "phone", label: "טלפון", sortable: true },
                { key: "city", label: "עיר", sortable: true },
                { key: "type", label: "סוג", sortable: true },
                { key: "active", label: "פעיל", sortable: true },
                { key: "created", label: "הצטרפות", sortable: true },
              ].map((col) => (
                <th key={col.key}>
                  <button
                    type="button"
                    className="adm-source-sort-btn"
                    disabled={!col.sortable || loading}
                    onClick={() => {
                      if (!col.sortable) return;
                      setSortKey(col.key);
                      setSortDir((d) => (sortKey === col.key && d === "asc" ? "desc" : "asc"));
                    }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {loading && !payload ? (
            <TableSkeleton columnCount={7} rowCount={8} />
          ) : (
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <TableEmpty />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="adm-source-pro-row adm-customers-source-row"
                    onMouseEnter={() => schedulePreview(r.id)}
                    onMouseLeave={() => schedulePreview(null)}
                    onDoubleClick={() =>
                      openWindow({
                        type: "customerCard",
                        props: { customerId: r.id, customerName: r.name, initialTab: "ledger" },
                      })
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="adm-source-primary-link"
                        onClick={() =>
                          openWindow({
                            type: "customerCard",
                            props: { customerId: r.id, customerName: r.name, initialTab: "ledger" },
                          })
                        }
                      >
                        {r.name || "—"}
                      </button>
                    </td>
                    <td dir="ltr">{r.code || "—"}</td>
                    <td dir="ltr">{r.phone || "—"}</td>
                    <td>{r.city || "—"}</td>
                    <td>{r.type || "—"}</td>
                    <td>{r.isActive ? "כן" : "לא"}</td>
                    <td dir="ltr">{r.created}</td>
                  </tr>
                ))
              )}
            </tbody>
          )}
        </table>
      </div>

      {hoverId && (preview || previewBusy) ? (
        <div className="adm-customers-preview-popover" role="tooltip" dir="rtl">
          {previewBusy && !preview ? (
            <p className="adm-customers-preview-meta">טוען…</p>
          ) : preview ? (
            <>
              <p>
                <strong>{preview.name}</strong>
              </p>
              <p>
                <span>קוד</span> <span dir="ltr">{preview.code}</span>
              </p>
              <p>
                <span>טלפון</span> <span dir="ltr">{preview.phone}</span>
              </p>
              <p>
                <span>עיר</span> {preview.city}
              </p>
              <p>
                <span>הצטרפות</span> <span dir="ltr">{preview.joinedYmd}</span>
              </p>
              <p>
                <span>הזמנות</span> {preview.orderCount}
              </p>
              <p>
                <span>יתרה</span> <span dir="ltr">${preview.balanceUsd}</span>
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
