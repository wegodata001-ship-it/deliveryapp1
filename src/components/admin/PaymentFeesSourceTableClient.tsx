"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePaymentMethodCatalog } from "@/components/admin/PaymentMethodCatalogProvider";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { PaymentFeeDetailModal } from "@/components/admin/PaymentFeeDetailModal";
import { PaymentFeeRowActionsMenu } from "@/components/admin/PaymentFeeRowActionsMenu";
import {
  exportPaymentFeesSourceAction,
  getPaymentFeeDetailAction,
  listPaymentFeesSourceTableAction,
  type PaymentFeesSourceListPayload,
} from "@/app/admin/source-tables/payment-fees-actions";
import { TableEmpty, TableError, TableSkeleton } from "@/components/ui/data-table";
import { downloadBase64File, handleSourceTableExportResult } from "@/lib/pdf-export-client";
import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import type { PaymentFeeDetail } from "@/lib/payment-fees-source-table";
import type { PaymentFeeSourceKind } from "@/lib/payment-adjustment-fee";
import { FileSpreadsheet, FileText, Hash, Search, TrendingDown, TrendingUp } from "lucide-react";

const PAGE_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 350;

type CompactFilters = {
  fromYmd: string;
  toYmd: string;
  customerCode: string;
  orderNumber: string;
  sourceKind: "" | PaymentFeeSourceKind;
  amountKind: "" | "CREDIT" | "DEBIT";
  paymentMethod: string;
};

const EMPTY_FILTERS: CompactFilters = {
  fromYmd: "",
  toYmd: "",
  customerCode: "",
  orderNumber: "",
  sourceKind: "",
  amountKind: "",
  paymentMethod: "",
};

const SOURCE_OPTIONS: Array<{ value: PaymentFeeSourceKind; label: string }> = [
  { value: "PAYMENT_INTAKE", label: "קליטת תשלום" },
  { value: "PAYMENT_SURPLUS", label: "תשלום יתר" },
  { value: "BALANCE_RESET", label: "איפוס יתרה" },
  { value: "MANUAL", label: "הזנה ידנית" },
  { value: "CORRECTION", label: "תיקון" },
  { value: "OTHER", label: "אחר" },
];

function formatDateDisplay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function sourceBadgeClass(kind: PaymentFeeSourceKind): string {
  return `adm-payment-fee-badge adm-payment-fee-badge--${kind.toLowerCase()}`;
}

export function PaymentFeesSourceTableClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { openWindow } = useAdminWindows();
  const { options: paymentMethodFilterOptions } = usePaymentMethodCatalog();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<CompactFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [payload, setPayload] = useState<PaymentFeesSourceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<"pdf" | "excel" | "csv" | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detail, setDetail] = useState<PaymentFeeDetail | null>(null);
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
        fromYmd: filters.fromYmd || undefined,
        toYmd: filters.toYmd || undefined,
        customerCode: filters.customerCode || undefined,
        orderNumber: filters.orderNumber || undefined,
        sourceKind: filters.sourceKind || undefined,
        amountKind: filters.amountKind || undefined,
        paymentMethod: filters.paymentMethod || undefined,
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

  const openOrder = useCallback(
    (orderId: string) => {
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
    },
    [openWindow],
  );

  const openPayment = useCallback(
    (paymentId: string) => {
      openWindow({ type: "paymentsUpdated", props: { paymentId } });
    },
    [openWindow],
  );

  async function showDetail(rowId: string) {
    setDetailBusy(true);
    setDetailOpen(true);
    const res = await getPaymentFeeDetailAction(rowId);
    setDetailBusy(false);
    if (!res.ok) {
      setLoadError(res.error);
      setDetailOpen(false);
      return;
    }
    setDetail(res.detail);
  }

  const rows = payload?.rows ?? [];
  const kpis = payload?.kpis;

  return (
    <div className="adm-source-pro adm-payment-fees-source" dir="rtl">
      {kpis ? (
        <div className="adm-payments-source-kpi-row adm-payment-fees-kpi-row" aria-label="סיכום עמלות">
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl">
              <TrendingUp size={16} strokeWidth={1.75} aria-hidden /> סה&quot;כ עמלות חיוביות
            </span>
            <strong dir="ltr" className="adm-payment-fee-amt--credit">
              {formatSignedUsdDisplay(kpis.positiveTotalUsd)}
            </strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl">
              <TrendingDown size={16} strokeWidth={1.75} aria-hidden /> סה&quot;כ קיזוזים / איפוסים
            </span>
            <strong dir="ltr" className="adm-payment-fee-amt--debit">
              {formatSignedUsdDisplay(kpis.negativeTotalUsd)}
            </strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl">נטו עמלות</span>
            <strong dir="ltr">{formatSignedUsdDisplay(kpis.netTotalUsd)}</strong>
          </div>
          <div className="adm-payments-source-kpi-card">
            <span className="adm-payments-source-kpi-lbl">
              <Hash size={16} strokeWidth={1.75} aria-hidden /> מספר פעולות
            </span>
            <strong>{kpis.operationCount.toLocaleString("he-IL")}</strong>
          </div>
        </div>
      ) : null}

      <div className="adm-source-pro-toolbar adm-source-pro-toolbar--sticky adm-payment-fees-toolbar">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="חיפוש חופשי: לקוח, הזמנה, תשלום, הערות…"
          aria-label="חיפוש עמלות"
          disabled={loading && !payload}
        />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("excel")}>
          <FileSpreadsheet size={14} aria-hidden /> Excel
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("csv")}>
          CSV
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!!exportBusy} onClick={() => void runExport("pdf")}>
          <FileText size={14} aria-hidden /> PDF
        </button>
      </div>

      <div className="adm-payment-fees-compact-filters" aria-label="סינון עמלות">
        <label>
          <span>תאריך מ</span>
          <input type="date" value={filters.fromYmd} onChange={(e) => setFilters((f) => ({ ...f, fromYmd: e.target.value }))} />
        </label>
        <label>
          <span>עד</span>
          <input type="date" value={filters.toYmd} onChange={(e) => setFilters((f) => ({ ...f, toYmd: e.target.value }))} />
        </label>
        <label>
          <span>לקוח</span>
          <input value={filters.customerCode} placeholder="קוד" onChange={(e) => setFilters((f) => ({ ...f, customerCode: e.target.value }))} />
        </label>
        <label>
          <span>הזמנה</span>
          <input value={filters.orderNumber} placeholder="#" onChange={(e) => setFilters((f) => ({ ...f, orderNumber: e.target.value }))} />
        </label>
        <label>
          <span>מקור</span>
          <select value={filters.sourceKind} onChange={(e) => setFilters((f) => ({ ...f, sourceKind: e.target.value as CompactFilters["sourceKind"] }))}>
            <option value="">הכל</option>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>סוג</span>
          <select value={filters.amountKind} onChange={(e) => setFilters((f) => ({ ...f, amountKind: e.target.value as CompactFilters["amountKind"] }))}>
            <option value="">הכל</option>
            <option value="CREDIT">חיובי</option>
            <option value="DEBIT">שלילי</option>
          </select>
        </label>
        <label>
          <span>אמצעי</span>
          <select value={filters.paymentMethod} onChange={(e) => setFilters((f) => ({ ...f, paymentMethod: e.target.value }))}>
            <option value="">הכל</option>
            {paymentMethodFilterOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          <Search size={14} aria-hidden /> נקה
        </button>
      </div>

      {loading && !payload ? (
        <TableSkeleton columnCount={10} rowCount={8} />
      ) : loadError ? (
        <TableError message={loadError} />
      ) : rows.length === 0 ? (
        <TableEmpty message="אין רשומות עמלות / הפרשי התאמה" />
      ) : (
        <div className="adm-payments-source-table-wrap adm-payment-fees-table-wrap">
          <table className="adm-payments-source-table adm-payment-fees-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("date")}>
                    תאריך
                  </button>
                </th>
                <th>
                  <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("customer")}>
                    לקוח
                  </button>
                </th>
                <th>
                  <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("order")}>
                    הזמנה
                  </button>
                </th>
                <th>
                  <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("source")}>
                    מקור
                  </button>
                </th>
                <th>סיבת העמלה</th>
                <th>
                  <button type="button" className="adm-source-sort-btn" onClick={() => toggleSort("amount")}>
                    סכום
                  </button>
                </th>
                <th>סוג</th>
                <th>אמצעי תשלום</th>
                <th>נוצר ע&quot;י</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="adm-source-pro-row adm-payment-fees-row"
                  onClick={() => void showDetail(r.id)}
                >
                  <td>{formatDateDisplay(r.createdAtYmd)}</td>
                  <td className="adm-payment-fees-cell-customer">
                    <strong>{r.customerName}</strong>
                    <span className="cc-muted">{r.customerCode}</span>
                  </td>
                  <td>
                    {r.orderId ? (
                      <button
                        type="button"
                        className="adm-source-primary-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrder(r.orderId!);
                        }}
                      >
                        #{r.orderNumber}
                      </button>
                    ) : (
                      r.orderNumber
                    )}
                  </td>
                  <td>
                    <span className={sourceBadgeClass(r.sourceKind)}>{r.sourceLabel}</span>
                  </td>
                  <td className="adm-payment-fees-cell-reason">{r.reasonLabel}</td>
                  <td
                    dir="ltr"
                    className={r.amountKind === "DEBIT" ? "adm-payment-fee-amt--debit" : "adm-payment-fee-amt--credit"}
                  >
                    {r.amountDisplay}
                  </td>
                  <td>
                    <span
                      className={`adm-payment-fee-badge adm-payment-fee-badge--${r.amountKind === "DEBIT" ? "debit" : "credit"}`}
                    >
                      {r.typeLabel}
                    </span>
                  </td>
                  <td>{r.paymentMethodLabel}</td>
                  <td>{r.createdByName}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <PaymentFeeRowActionsMenu
                      row={r}
                      onShowDetail={() => void showDetail(r.id)}
                      onOpenOrder={openOrder}
                      onOpenPayment={openPayment}
                      onCancel={
                        r.isAutomatic
                          ? () => setLoadError("עמלה אוטומטית מתשלום — יש לבצע Reversal דרך ביטול/תיקון התשלום")
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payload && payload.totalPages > 1 ? (
        <div className="adm-source-pro-pager">
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

      <PaymentFeeDetailModal
        open={detailOpen}
        detail={detail}
        busy={detailBusy}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        onOpenOrder={openOrder}
        onOpenPayment={openPayment}
      />
    </div>
  );
}
