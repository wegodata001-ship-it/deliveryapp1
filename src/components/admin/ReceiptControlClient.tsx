"use client";

import { useEffect, useMemo, useState } from "react";
import { listReceiptControlAction, type ReceiptBalanceFilter, type ReceiptControlPayload, type ReceiptControlRow, type ReceiptControlStatus } from "@/app/admin/receipt-control/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

const LIMIT = 15;

const STATUS_LABELS: Record<ReceiptControlStatus, string> = {
  DEBT: "חוב",
  CREDIT: "זכות",
  BALANCED: "מאוזן",
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
  const [page, setPage] = useState(1);
  const [weekCode, setWeekCode] = useState("");
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<ReceiptBalanceFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listReceiptControlAction({
      page,
      limit: LIMIT,
      weekCode,
      fromYmd,
      toYmd,
      balanceFilter,
      search,
    }).then((next) => {
      if (cancelled) return;
      setPayload(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page, weekCode, fromYmd, toYmd, balanceFilter, search]);

  const pages = useMemo(() => pageNumbers(payload?.page ?? page, payload?.totalPages ?? 1), [payload?.page, payload?.totalPages, page]);

  function setTopFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  function clearFilters() {
    setWeekCode("");
    setFromYmd("");
    setToYmd("");
    setBalanceFilter("all");
    setSearch("");
    setPage(1);
  }

  function openPayment(row: ReceiptControlRow) {
    if (!row.customerId) return;
    openWindow({
      type: "payments",
      props: {
        customerId: row.customerId,
        customerName: row.customerName,
        amountIls: row.balance,
      },
    });
  }

  return (
    <div className="adm-receipt-control">
      <div className="adm-receipt-head">
        <div>
          <h1>בקרת תקבולים</h1>
          <p>מרוכז לפי לקוח: חשבוניות, תשלומים ויתרה.</p>
        </div>
        <div className="adm-receipt-actions">
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
          <select value={balanceFilter} onChange={(e) => setTopFilter(() => setBalanceFilter(e.target.value as ReceiptBalanceFilter))}>
            <option value="all">הכל</option>
            <option value="debt">חוב</option>
            <option value="credit">זכות</option>
            <option value="balanced">מאוזן</option>
          </select>
        </label>
        <label>
          חיפוש
          <input value={search} onChange={(e) => setTopFilter(() => setSearch(e.target.value))} placeholder="שם לקוח..." />
        </label>
      </div>

      <div className="adm-receipt-summary">
        <div className="adm-receipt-summary-card adm-receipt-summary-card--expected">
          <span>סה״כ חשבוניות</span>
          <strong dir="ltr">{ils(payload?.totalInvoices ?? "0")}</strong>
        </div>
        <div className="adm-receipt-summary-card adm-receipt-summary-card--received">
          <span>סה״כ תשלומים</span>
          <strong dir="ltr">{ils(payload?.totalPayments ?? "0")}</strong>
        </div>
        <div className="adm-receipt-summary-card adm-receipt-summary-card--remaining">
          <span>סה״כ יתרה</span>
          <strong dir="ltr">{ils(payload?.totalBalance ?? "0")}</strong>
        </div>
      </div>

      <div className="adm-receipt-table-wrap" aria-busy={loading}>
        {loading ? <div className="adm-receipt-loading"><span className="adm-spin" /> טוען…</div> : null}
        <table className="adm-table adm-receipt-table">
          <thead>
            <tr>
              <th>לקוח</th>
              <th>סה"כ חשבוניות</th>
              <th>סה"כ תשלומים</th>
              <th>יתרה</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {!payload || payload.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="adm-table-empty">לא נמצאו תקבולים להצגה.</td>
              </tr>
            ) : (
              payload.rows.map((row) => (
                <tr key={row.customerId || row.customerName} className={`adm-receipt-row adm-receipt-row--${row.status.toLowerCase()}`}>
                  <td>
                    {row.customerId ? (
                      <button
                        type="button"
                        className="adm-balance-link"
                        onClick={() =>
                          openWindow({
                            type: "customerCard",
                            props: { customerId: row.customerId, customerName: row.customerName, initialTab: "ledger" },
                          })
                        }
                      >
                        {row.customerName}
                      </button>
                    ) : (
                      row.customerName
                    )}
                  </td>
                  <td dir="ltr">{ils(row.totalInvoices)}</td>
                  <td dir="ltr">{ils(row.totalPayments)}</td>
                  <td>
                    <button
                      type="button"
                      className="adm-receipt-remaining-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPayment(row);
                      }}
                      disabled={!row.customerId || Number(row.balance) <= 0}
                      title="פתיחת קליטת תשלום"
                    >
                      <span dir="ltr">{ils(row.balance)}</span>
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

    </div>
  );
}
