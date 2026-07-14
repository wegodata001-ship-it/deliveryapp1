"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePaymentMethodCatalog } from "@/components/admin/PaymentMethodCatalogProvider";
import {
  exportPaymentFeesSourceAction,
  listPaymentFeesSourceTableAction,
  type PaymentFeesSourceListPayload,
} from "@/app/admin/source-tables/payment-fees-actions";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import { downloadBase64File, handleSourceTableExportResult } from "@/lib/pdf-export-client";
import { FileSpreadsheet, FileText, Search } from "lucide-react";
import type { PaymentAdjustmentReason, PaymentAdjustmentStatus } from "@prisma/client";

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;

type AdvancedFilters = {
  customerCode: string;
  sourceDocument: string;
  paymentMethod: string;
  status: "" | PaymentAdjustmentStatus;
  reason: "" | PaymentAdjustmentReason;
  fromYmd: string;
  toYmd: string;
  amountMin: string;
  amountMax: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  customerCode: "",
  sourceDocument: "",
  paymentMethod: "",
  status: "",
  reason: "",
  fromYmd: "",
  toYmd: "",
  amountMin: "",
  amountMax: "",
};

const REASON_OPTIONS: Array<{ value: PaymentAdjustmentReason; label: string }> = [
  { value: "PAYMENT_SURPLUS", label: "הפרש תשלום" },
  { value: "METHOD_DEVIATION", label: "חריגת אמצעי תשלום" },
  { value: "BANK_FEE", label: "עמלת בנק" },
  { value: "FX_DIFF", label: "הפרש שער" },
  { value: "ROUNDING", label: "עיגול" },
  { value: "MANUAL_ADJUST", label: "התאמה ידנית" },
  { value: "OTHER", label: "אחר" },
];

function fmtUsd(n: string): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return `$${n}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateDisplay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function PaymentFeesSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { options: paymentMethodFilterOptions } = usePaymentMethodCatalog();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [payload, setPayload] = useState<PaymentFeesSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | "csv" | null>(null);
  const fetchGen = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(
    (p: number) => ({
      page: p,
      limit: PAGE_LIMIT,
      sortKey,
      sortDir,
      search: debouncedSearch,
      filters: {
        customerCode: filters.customerCode || undefined,
        sourceDocument: filters.sourceDocument || undefined,
        paymentMethod: filters.paymentMethod || undefined,
        status: filters.status || undefined,
        reason: filters.reason || undefined,
        fromYmd: filters.fromYmd || undefined,
        toYmd: filters.toYmd || undefined,
        amountMin: filters.amountMin || undefined,
        amountMax: filters.amountMax || undefined,
      },
    }),
    [debouncedSearch, filters, sortDir, sortKey],
  );

  useEffect(() => {
    const gen = ++fetchGen.current;
    setLoading(true);
    setLoadError(null);
    void listPaymentFeesSourceTableAction(buildQuery(page))
      .then((res) => {
        if (gen !== fetchGen.current) return;
        setPayload(res);
      })
      .catch((e) => {
        if (gen !== fetchGen.current) return;
        setLoadError(e instanceof Error ? e.message : "טעינה נכשלה");
      })
      .finally(() => {
        if (gen === fetchGen.current) setLoading(false);
      });
  }, [buildQuery, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters, sortKey, sortDir]);

  async function runExport(kind: "pdf" | "excel" | "csv") {
    setExportBusy(kind);
    try {
      const res = await exportPaymentFeesSourceAction(buildQuery(1), kind);
      handleSourceTableExportResult(kind, res, setLoadError, downloadBase64File);
    } finally {
      setExportBusy(null);
    }
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  const rows = payload?.rows ?? [];
  const kpis = payload?.kpis;

  return (
    <div className="adm-source-pro" dir="rtl">
      <div className="adm-source-pro__toolbar">
        <div className="adm-source-pro__search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="חיפוש לפי מסמך, לקוח או קוד לקוח…"
            aria-label="חיפוש עמלות"
          />
        </div>
        <div className="adm-source-pro__export">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("excel")}>
            <FileSpreadsheet size={14} aria-hidden /> {exportBusy === "excel" ? "…" : "Excel"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("csv")}>
            CSV
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("pdf")}>
            <FileText size={14} aria-hidden /> {exportBusy === "pdf" ? "…" : "PDF"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setFilterOpen((v) => !v)}>
            {filterOpen ? "הסתר סינון" : "סינון"}
          </button>
        </div>
      </div>

      {kpis ? (
        <div className="adm-source-pro__kpi-row" aria-label="סיכום עמלות">
          <div className="adm-source-pro__kpi">
            <span>פתוח</span>
            <strong>{kpis.openCount}</strong>
          </div>
          <div className="adm-source-pro__kpi">
            <span>סכום פתוח</span>
            <strong dir="ltr">{fmtUsd(kpis.openAmountUsd)}</strong>
          </div>
          <div className="adm-source-pro__kpi">
            <span>נסגר</span>
            <strong>{kpis.closedCount}</strong>
          </div>
          <div className="adm-source-pro__kpi">
            <span>בוטל</span>
            <strong>{kpis.cancelledCount}</strong>
          </div>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="adm-source-pro__filters">
          <label>
            קוד לקוח
            <input value={filters.customerCode} onChange={(e) => setFilters((f) => ({ ...f, customerCode: e.target.value }))} />
          </label>
          <label>
            מסמך / קליטה
            <input value={filters.sourceDocument} onChange={(e) => setFilters((f) => ({ ...f, sourceDocument: e.target.value }))} />
          </label>
          <label>
            אמצעי תשלום
            <select value={filters.paymentMethod} onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value }))}>
              <option value="">הכל</option>
              {paymentMethodFilterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            סטטוס
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as AdvancedFilters["status"] }))}
            >
              <option value="">הכל</option>
              <option value="OPEN">פתוח</option>
              <option value="CLOSED">נסגר</option>
              <option value="CANCELLED">בוטל</option>
            </select>
          </label>
          <label>
            סיבה
            <select
              value={filters.reason}
              onChange={(e) => setFilters((f) => ({ ...f, reason: e.target.value as AdvancedFilters["reason"] }))}
            >
              <option value="">הכל</option>
              {REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            מתאריך
            <input type="date" value={filters.fromYmd} onChange={(e) => setFilters((f) => ({ ...f, fromYmd: e.target.value }))} />
          </label>
          <label>
            עד תאריך
            <input type="date" value={filters.toYmd} onChange={(e) => setFilters((f) => ({ ...f, toYmd: e.target.value }))} />
          </label>
          <label>
            סכום מ־
            <input value={filters.amountMin} onChange={(e) => setFilters((f) => ({ ...f, amountMin: e.target.value }))} inputMode="decimal" />
          </label>
          <label>
            סכום עד
            <input value={filters.amountMax} onChange={(e) => setFilters((f) => ({ ...f, amountMax: e.target.value }))} inputMode="decimal" />
          </label>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            נקה
          </button>
        </div>
      ) : null}

      {loading && !payload ? (
        <TableSkeleton columnCount={9} rowCount={8} />
      ) : loadError ? (
        <TableError message={loadError} />
      ) : rows.length === 0 ? (
        <TableEmpty message="אין רשומות עמלות / הפרשי התאמה" />
      ) : (
        <div className="adm-source-pro__table-wrap">
          <table className="adm-source-pro__table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => toggleSort("date")}>
                    תאריך
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort("customer")}>
                    לקוח
                  </button>
                </th>
                <th>מסמך מקור</th>
                <th>אמצעי תשלום</th>
                <th>
                  <button type="button" onClick={() => toggleSort("amount")}>
                    סכום
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort("reason")}>
                    סיבה
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => toggleSort("status")}>
                    סטטוס
                  </button>
                </th>
                <th>משתמש</th>
                <th>תאריך סגירה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateDisplay(r.createdAtYmd)}</td>
                  <td>
                    <div className="adm-source-pro__cell-stack">
                      <strong>{r.customerName}</strong>
                      <span className="cc-muted">{r.customerCode}</span>
                    </div>
                  </td>
                  <td>
                    <div className="adm-source-pro__cell-stack">
                      <span>{r.sourceDocumentCode}</span>
                      <span className="cc-muted">{r.paymentCaptureCode}</span>
                    </div>
                  </td>
                  <td>{r.paymentMethodLabel}</td>
                  <td dir="ltr">{fmtUsd(r.amountUsd)}</td>
                  <td>{r.reasonLabel}</td>
                  <td>
                    <span className={`adm-badge adm-badge--${r.status === "OPEN" ? "warn" : r.status === "CLOSED" ? "ok" : "muted"}`}>
                      {r.statusLabel}
                    </span>
                  </td>
                  <td>{r.createdByName}</td>
                  <td>{r.closedAtYmd === "—" ? "—" : formatDateDisplay(r.closedAtYmd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payload && payload.totalPages > 1 ? (
        <div className="adm-source-pro__pager">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            הקודם
          </button>
          <span>
            עמוד {payload.page} מתוך {payload.totalPages}
          </span>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--sm"
            disabled={page >= payload.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            הבא
          </button>
        </div>
      ) : null}
    </div>
  );
}
