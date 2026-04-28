"use client";

import { useEffect, useMemo, useState } from "react";
import { listReceiptControlAction, type ReceiptControlPayload, type ReceiptControlRow, type ReceiptControlStatus } from "@/app/admin/receipt-control/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { Modal } from "@/components/ui/Modal";

const LIMIT = 15;

const STATUS_LABELS: Record<ReceiptControlStatus, string> = {
  PAID: "שולם",
  PARTIAL: "חלקי",
  UNPAID: "לא שולם",
};

type ColumnFilters = {
  week: string;
  customerName: string;
  expectedILS: string;
  receivedILS: string;
  remainingILS: string;
};

function ils(s: string): string {
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return `₪ ${s}`;
  return `₪ ${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - 1);
  const end = Math.min(totalPages, start + 2);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function ReceiptControlClient() {
  const { openWindow } = useAdminWindows();
  const [payload, setPayload] = useState<ReceiptControlPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [weekCode, setWeekCode] = useState("");
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [status, setStatus] = useState<ReceiptControlStatus | "">("");
  const [filters, setFilters] = useState<ColumnFilters>({
    week: "",
    customerName: "",
    expectedILS: "",
    receivedILS: "",
    remainingILS: "",
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [detailsRow, setDetailsRow] = useState<ReceiptControlRow | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listReceiptControlAction({
      page,
      limit: LIMIT,
      weekCode,
      fromYmd,
      toYmd,
      status,
      filters: debouncedFilters,
    }).then((next) => {
      if (cancelled) return;
      setPayload(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page, weekCode, fromYmd, toYmd, status, debouncedFilters]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  function setTopFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  function clearFilters() {
    setWeekCode("");
    setFromYmd("");
    setToYmd("");
    setStatus("");
    setFilters({ week: "", customerName: "", expectedILS: "", receivedILS: "", remainingILS: "" });
    setDebouncedFilters({ week: "", customerName: "", expectedILS: "", receivedILS: "", remainingILS: "" });
    setPage(1);
  }

  function openPayment(row: ReceiptControlRow) {
    if (!row.customerId) return;
    openWindow({
      type: "payments",
      props: {
        customerId: row.customerId,
        customerName: row.customerName,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        amountIls: row.remainingILS,
      },
    });
  }

  return (
    <div className="adm-receipt-control">
      <div className="adm-receipt-head">
        <div>
          <h1>בקרת תקבולים</h1>
          <p>בקרה פיננסית: מה נכנס, מה חסר ומה צריך לגבות.</p>
        </div>
        <div className="adm-receipt-actions">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setShowFilters((v) => !v)}>
            סינון 🔍
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={clearFilters}>
            נקה סינון
          </button>
        </div>
      </div>

      <div className="adm-receipt-top-filters">
        <label>
          שבוע
          <input value={weekCode} onChange={(e) => setTopFilter(() => setWeekCode(e.target.value))} placeholder="AH-118" />
        </label>
        <label>
          מתאריך
          <input type="date" value={fromYmd} onChange={(e) => setTopFilter(() => setFromYmd(e.target.value))} />
        </label>
        <label>
          עד תאריך
          <input type="date" value={toYmd} onChange={(e) => setTopFilter(() => setToYmd(e.target.value))} />
        </label>
        <label>
          סטטוס
          <select value={status} onChange={(e) => setTopFilter(() => setStatus(e.target.value as ReceiptControlStatus | ""))}>
            <option value="">הכל</option>
            <option value="PAID">שולם</option>
            <option value="PARTIAL">חלקי</option>
            <option value="UNPAID">לא שולם</option>
          </select>
        </label>
      </div>

      <div className="adm-receipt-summary">
        <div className="adm-receipt-summary-card adm-receipt-summary-card--expected">
          <span>סה״כ צפוי</span>
          <strong dir="ltr">{ils(payload?.totalExpected ?? "0")}</strong>
        </div>
        <div className="adm-receipt-summary-card adm-receipt-summary-card--received">
          <span>סה״כ התקבל</span>
          <strong dir="ltr">{ils(payload?.totalReceived ?? "0")}</strong>
        </div>
        <div className="adm-receipt-summary-card adm-receipt-summary-card--remaining">
          <span>סה״כ יתרה</span>
          <strong dir="ltr">{ils(payload?.totalRemaining ?? "0")}</strong>
        </div>
      </div>

      <div className="adm-receipt-table-wrap" aria-busy={loading}>
        {loading ? <div className="adm-receipt-loading">טוען…</div> : null}
        <table className="adm-table adm-receipt-table">
          <thead>
            <tr>
              <th>שבוע</th>
              <th>לקוח</th>
              <th>צפי בשקלים</th>
              <th>התקבל</th>
              <th>הפרש</th>
              <th>יתרה</th>
              <th>סטטוס</th>
            </tr>
            {showFilters ? (
              <tr className="adm-receipt-filter-row">
                <th><input value={filters.week} onChange={(e) => setFilters((f) => ({ ...f, week: e.target.value }))} placeholder="week" /></th>
                <th><input value={filters.customerName} onChange={(e) => setFilters((f) => ({ ...f, customerName: e.target.value }))} placeholder="customerName" /></th>
                <th><input value={filters.expectedILS} onChange={(e) => setFilters((f) => ({ ...f, expectedILS: e.target.value }))} placeholder="expectedILS" /></th>
                <th><input value={filters.receivedILS} onChange={(e) => setFilters((f) => ({ ...f, receivedILS: e.target.value }))} placeholder="receivedILS" /></th>
                <th />
                <th><input value={filters.remainingILS} onChange={(e) => setFilters((f) => ({ ...f, remainingILS: e.target.value }))} placeholder="remainingILS" /></th>
                <th />
              </tr>
            ) : null}
          </thead>
          <tbody>
            {!payload || payload.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="adm-table-empty">לא נמצאו תקבולים להצגה.</td>
              </tr>
            ) : (
              payload.rows.map((row) => (
                <tr key={row.orderId} className={`adm-receipt-row adm-receipt-row--${row.status.toLowerCase()}`} onClick={() => setDetailsRow(row)}>
                  <td dir="ltr">{row.week}</td>
                  <td>{row.customerName}</td>
                  <td dir="ltr">{ils(row.expectedILS)}</td>
                  <td dir="ltr">{ils(row.receivedILS)}</td>
                  <td dir="ltr">{ils(row.difference)}</td>
                  <td>
                    <button
                      type="button"
                      className="adm-receipt-remaining-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPayment(row);
                      }}
                      disabled={!row.customerId || Number(row.remainingILS) <= 0}
                      title="פתיחת קליטת תשלום"
                    >
                      <span dir="ltr">{ils(row.remainingILS)}</span>
                    </button>
                  </td>
                  <td>
                    <span className={`adm-receipt-status adm-receipt-status--${row.status.toLowerCase()}`}>
                      {STATUS_LABELS[row.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="adm-receipt-pagination">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" disabled={(payload?.page ?? page) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={p === (payload?.page ?? page) ? "adm-page-btn adm-page-btn--active" : "adm-page-btn"}
            onClick={() => setPage(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--xs"
          disabled={(payload?.page ?? page) >= (payload?.totalPages ?? 1)}
          onClick={() => setPage((p) => Math.min(payload?.totalPages ?? 1, p + 1))}
        >
          Next
        </button>
        <span className="adm-receipt-page-meta">
          {payload?.totalRows ?? 0} שורות
        </span>
      </div>

      <Modal open={!!detailsRow} onClose={() => setDetailsRow(null)} title="פירוט תקבולים" size="lg">
        {detailsRow ? (
          <div className="adm-receipt-details">
            <div className="adm-receipt-details-grid">
              <span>לקוח</span><strong>{detailsRow.customerName}</strong>
              <span>הזמנה</span><strong dir="ltr">{detailsRow.orderNumber}</strong>
              <span>שבוע</span><strong dir="ltr">{detailsRow.week}</strong>
              <span>יתרה</span><strong dir="ltr">{ils(detailsRow.remainingILS)}</strong>
            </div>
            <h3>תקבולים מקושרים</h3>
            {detailsRow.payments.length === 0 ? (
              <p className="adm-table-empty">אין תשלומים מקושרים להזמנה.</p>
            ) : (
              <table className="adm-table adm-table--dense">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>מספר תשלום</th>
                    <th>סכום</th>
                    <th>אמצעי</th>
                    <th>מקום</th>
                  </tr>
                </thead>
                <tbody>
                  {detailsRow.payments.map((p) => (
                    <tr key={p.id}>
                      <td dir="ltr">{p.paymentDateYmd}</td>
                      <td dir="ltr">{p.paymentCode ?? "—"}</td>
                      <td dir="ltr">{ils(p.amountIls)}</td>
                      <td>{p.paymentMethod ?? "—"}</td>
                      <td>{p.paymentPlace ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
