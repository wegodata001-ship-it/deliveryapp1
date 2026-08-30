"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Eye, FilterX, Info, RefreshCw, X } from "lucide-react";
import {
  listPaymentMethodAutoAdjustmentsAction,
  loadPaymentMethodAdjustmentTrailAction,
  markPaymentMethodAutoAdjustmentReviewedAction,
  type PaymentMethodAdjustmentAdminRow,
  type PaymentMethodAdjustmentTrailEvent,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import { PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS } from "@/lib/payment-method-auto-adjustment";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDatePart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtTimePart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtUsd(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtIls(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return `₪${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reasonLabel(code: string): string {
  return PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.find((row) => row.code === code)?.label ?? code;
}

function hasRealBalanceSnapshot(details: PaymentMethodAdjustmentAdminRow["details"]): boolean {
  return Boolean(
    details.beforeSourceBalance != null &&
      details.afterSourceBalance != null &&
      details.beforeTargetBalance != null &&
      details.afterTargetBalance != null,
  );
}

function StatusBadge({ reviewed }: { reviewed: boolean }) {
  return (
    <span className={`pm-adjust-page__status-badge${reviewed ? " is-reviewed" : " is-new"}`}>
      {reviewed ? "בוצע / נבדק" : "חדש"}
    </span>
  );
}

function MethodChangeCell({
  fromLabel,
  toLabel,
  compact = false,
}: {
  fromLabel: string;
  toLabel: string;
  compact?: boolean;
}) {
  return (
    <div className={`pm-adjust-page__method-change${compact ? " is-compact" : ""}`}>
      <div className="pm-adjust-page__method-change-col pm-adjust-page__method-change-col--from">
        <span className="pm-adjust-page__method-change-label">מקור</span>
        <strong>{fromLabel}</strong>
      </div>
      <div className="pm-adjust-page__method-change-arrow" aria-hidden>
        <ArrowDown size={14} />
      </div>
      <div className="pm-adjust-page__method-change-col pm-adjust-page__method-change-col--to">
        <span className="pm-adjust-page__method-change-label">חדש</span>
        <strong>{toLabel}</strong>
      </div>
    </div>
  );
}

function humanSummary(row: PaymentMethodAdjustmentAdminRow): string {
  const n = row.affectedOrdersCount;
  const ordersWord = n === 1 ? "הזמנה אחת" : `${n} הזמנות`;
  return `אמצעי התשלום של ${ordersWord} בסכום ${fmtUsd(row.amountUsd)} שונה מ${row.fromLabel} ל${row.toLabel}.`;
}

export function PaymentMethodAdjustmentsClient() {
  const [rows, setRows] = useState<PaymentMethodAdjustmentAdminRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<PaymentMethodAdjustmentTrailEvent[]>([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [marking, setMarking] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await listPaymentMethodAutoAdjustmentsAction();
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setRows(res.rows);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setTrail([]);
      return;
    }
    let cancelled = false;
    setTrailLoading(true);
    void loadPaymentMethodAdjustmentTrailAction(selectedId).then((res) => {
      if (cancelled) return;
      setTrailLoading(false);
      setTrail(res.ok ? res.events : []);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const employeeOptions = useMemo(
    () => [...new Set(rows.map((row) => row.employeeName).filter(Boolean))],
    [rows],
  );
  const fromOptions = useMemo(
    () => [...new Set(rows.map((row) => row.fromLabel).filter(Boolean))],
    [rows],
  );
  const toOptions = useMemo(
    () => [...new Set(rows.map((row) => row.toLabel).filter(Boolean))],
    [rows],
  );

  const filtersActive = Boolean(
    search.trim() || dateFrom || dateTo || fromFilter || toFilter || employeeFilter || statusFilter,
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const dateKey = fmtDateInput(row.createdAtIso);
      const statusKey = row.reviewed ? "reviewed" : "new";
      if (q) {
        const hay = `${row.customerName} ${row.customerCode ?? ""} ${row.employeeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateFrom && dateKey < dateFrom) return false;
      if (dateTo && dateKey > dateTo) return false;
      if (fromFilter && row.fromLabel !== fromFilter) return false;
      if (toFilter && row.toLabel !== toFilter) return false;
      if (employeeFilter && row.employeeName !== employeeFilter) return false;
      if (statusFilter && statusKey !== statusFilter) return false;
      return true;
    });
  }, [rows, search, dateFrom, dateTo, fromFilter, toFilter, employeeFilter, statusFilter]);

  const selectedRow = useMemo(
    () => filteredRows.find((row) => row.id === selectedId) ?? rows.find((row) => row.id === selectedId) ?? null,
    [filteredRows, rows, selectedId],
  );

  const kpis = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todaysRows = filteredRows.filter((row) => fmtDateInput(row.createdAtIso) === today);
    const amountToday = todaysRows.reduce((sum, row) => sum + Number(row.amountUsd), 0);
    const ordersToday = todaysRows.reduce((sum, row) => sum + row.affectedOrdersCount, 0);
    const pendingReview = filteredRows.filter((row) => !row.reviewed).length;
    return {
      todayCount: todaysRows.length,
      todayAmount: amountToday.toFixed(2),
      ordersToday,
      pendingReview,
    };
  }, [filteredRows]);

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setFromFilter("");
    setToFilter("");
    setEmployeeFilter("");
    setStatusFilter("");
  }

  async function markReviewed() {
    if (!selectedRow || selectedRow.reviewed) return;
    setMarking(true);
    const res = await markPaymentMethodAutoAdjustmentReviewedAction(selectedRow.id);
    setMarking(false);
    if (res.ok) {
      setSelectedId(null);
      void load();
    }
  }

  return (
    <div className="pm-adjust-page adm-page--page-scroll" dir="rtl">
      <section className="pm-adjust-page__hero">
        <div className="pm-adjust-page__hero-copy">
          <p className="pm-adjust-page__eyebrow">בקרות</p>
          <h1 className="pm-adjust-page__title">התאמות אמצעי תשלום</h1>
          <p className="pm-adjust-page__lead">
            מעקב ובקרה אחר שינויים באמצעי התשלום של הזמנות.
            כאן ניתן לראות מה היה אמצעי התשלום המקורי, לאיזה אמצעי התבקש שינוי,
            מי ביצע את הפעולה, אילו הזמנות הושפעו ומה הייתה הסיבה לשינוי.
          </p>
          <p className="pm-adjust-page__info">
            <Info size={15} aria-hidden />
            <span>התאמה משנה את שיוך אמצעי התשלום בלבד ואינה משנה את סכום התשלום הכולל.</span>
          </p>
        </div>
        <button type="button" className="adm-btn pm-adjust-page__refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} aria-hidden />
          רענן
        </button>
      </section>

      <section className="pm-adjust-page__kpis" aria-label="סיכום">
        <article className="pm-adjust-page__kpi pm-adjust-page__kpi--today">
          <span>התאמות היום</span>
          <strong>{kpis.todayCount}</strong>
        </article>
        <article className="pm-adjust-page__kpi pm-adjust-page__kpi--amount">
          <span>סכום שהותאם היום</span>
          <strong dir="ltr">{fmtUsd(kpis.todayAmount)}</strong>
        </article>
        <article className="pm-adjust-page__kpi pm-adjust-page__kpi--orders">
          <span>הזמנות שהושפעו</span>
          <strong>{kpis.ordersToday}</strong>
        </article>
        <article className="pm-adjust-page__kpi pm-adjust-page__kpi--pending">
          <span>ממתינות לאישור / בדיקה</span>
          <strong>{kpis.pendingReview}</strong>
        </article>
      </section>

      <section className="pm-adjust-page__filters" aria-label="מסננים">
        <label className="pm-adjust-page__filter">
          <span>מלקוח / קוד</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש..." />
        </label>
        <label className="pm-adjust-page__filter">
          <span>מתאריך</span>
          <input type="date" dir="ltr" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="pm-adjust-page__filter">
          <span>עד תאריך</span>
          <input type="date" dir="ltr" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="pm-adjust-page__filter">
          <span>אמצעי מקור</span>
          <select value={fromFilter} onChange={(e) => setFromFilter(e.target.value)}>
            <option value="">הכול</option>
            {fromOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="pm-adjust-page__filter">
          <span>אמצעי יעד</span>
          <select value={toFilter} onChange={(e) => setToFilter(e.target.value)}>
            <option value="">הכול</option>
            {toOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="pm-adjust-page__filter">
          <span>עובד</span>
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">הכול</option>
            {employeeOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="pm-adjust-page__filter">
          <span>סטטוס</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">הכול</option>
            <option value="new">חדש</option>
            <option value="reviewed">בוצע / נבדק</option>
          </select>
        </label>
        {filtersActive ? (
          <button type="button" className="adm-btn pm-adjust-page__clear-filters" onClick={clearFilters}>
            <FilterX size={15} aria-hidden />
            נקה סינונים
          </button>
        ) : (
          <div className="pm-adjust-page__filter-spacer" aria-hidden />
        )}
      </section>

      {err ? <p className="adm-inline-error">{err}</p> : null}

      <section className="pm-adjust-page__table-card">
        <div className="pm-adjust-page__table-head">
          <div>
            <h2>רשימת התאמות</h2>
            <p>
              {loading ? "טוען..." : `${filteredRows.length} רשומות מוצגות`}
            </p>
          </div>
        </div>

        <div className="pm-adjust-page__table-wrap">
          <table className="adm-table pm-adjust-page__table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>לקוח</th>
                <th>שינוי אמצעי</th>
                <th>סכום</th>
                <th>הזמנות</th>
                <th>סיבה</th>
                <th>בוצע ע״י</th>
                <th>סטטוס</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="adm-table-empty">
                    אין התאמות אמצעי תשלום להצגה.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="pm-adjust-page__row">
                    <td>
                      <div className="pm-adjust-page__date-cell" dir="ltr">
                        <strong>{fmtDatePart(row.createdAtIso)}</strong>
                        <span>{fmtTimePart(row.createdAtIso)}</span>
                      </div>
                    </td>
                    <td>
                      <strong>{row.customerName}</strong>
                      {row.customerCode ? (
                        <div dir="ltr" className="pm-adjust-page__customer-code">
                          #{row.customerCode}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <MethodChangeCell fromLabel={row.fromLabel} toLabel={row.toLabel} compact />
                    </td>
                    <td className="pm-adjust-page__money-strong" dir="ltr">
                      {fmtUsd(row.amountUsd)}
                    </td>
                    <td>
                      {row.affectedOrdersCount === 1
                        ? "1 הזמנה"
                        : `${row.affectedOrdersCount} הזמנות`}
                    </td>
                    <td className="pm-adjust-page__reason-cell">
                      <span title={row.reasonText}>{reasonLabel(row.details.reasonCode)}</span>
                    </td>
                    <td>{row.employeeName}</td>
                    <td>
                      <StatusBadge reviewed={row.reviewed} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="adm-btn adm-btn--primary pm-adjust-page__view-btn"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <Eye size={15} aria-hidden />
                        צפייה
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pm-adjust-page__cards">
          {filteredRows.map((row) => (
            <article key={row.id} className="pm-adjust-page__mobile-card">
              <div className="pm-adjust-page__mobile-head">
                <div>
                  <strong>{row.customerName}</strong>
                  {row.customerCode ? (
                    <div dir="ltr" className="pm-adjust-page__customer-code">
                      #{row.customerCode}
                    </div>
                  ) : null}
                  <div className="pm-adjust-page__mobile-meta" dir="ltr">
                    {fmtDateTime(row.createdAtIso)}
                  </div>
                </div>
                <StatusBadge reviewed={row.reviewed} />
              </div>
              <MethodChangeCell fromLabel={row.fromLabel} toLabel={row.toLabel} />
              <p dir="ltr" className="pm-adjust-page__money-strong">
                {fmtUsd(row.amountUsd)}
              </p>
              <p className="pm-adjust-page__mobile-reason">{reasonLabel(row.details.reasonCode)}</p>
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                onClick={() => setSelectedId(row.id)}
              >
                <Eye size={15} aria-hidden />
                צפייה
              </button>
            </article>
          ))}
        </div>
      </section>

      {selectedRow ? (
        <div
          className="adm-cash-modal-backdrop pm-adjust-page__backdrop"
          role="presentation"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="adm-cash-modal pm-adjust-page__detail-modal"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pm-adjust-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pm-adjust-page__detail-head">
              <div>
                <h3 id="pm-adjust-detail-title">פרטי התאמת אמצעי תשלום</h3>
                <p className="pm-adjust-page__detail-sub">
                  <strong>
                    {selectedRow.customerName}
                    {selectedRow.customerCode ? ` #${selectedRow.customerCode}` : ""}
                  </strong>
                  <span aria-hidden> · </span>
                  <span dir="ltr">
                    {fmtDatePart(selectedRow.createdAtIso)} • {fmtTimePart(selectedRow.createdAtIso)}
                  </span>
                  <span aria-hidden> · </span>
                  <span>בוצע על ידי {selectedRow.employeeName}</span>
                </p>
              </div>
              <button
                type="button"
                className="pm-adjust-page__detail-close"
                aria-label="סגור"
                onClick={() => setSelectedId(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="pm-adjust-page__detail-body">
              <section className="pm-adjust-page__story">
                <p className="pm-adjust-page__story-text">{humanSummary(selectedRow)}</p>
                <div className="pm-adjust-page__story-reason">
                  <span>סיבת השינוי</span>
                  <strong>{reasonLabel(selectedRow.details.reasonCode)}</strong>
                  {selectedRow.reasonText.trim() &&
                  selectedRow.reasonText.trim() !== reasonLabel(selectedRow.details.reasonCode) ? (
                    <p>{selectedRow.reasonText}</p>
                  ) : null}
                </div>
                <p className="pm-adjust-page__not-payment-note">
                  התאמה זו אינה יוצרת תשלום חדש. היא משנה רק את שיוך אמצעי התשלום של הסכום שנבחר.
                </p>
              </section>

              <section className="pm-adjust-page__before-after" aria-label="לפני שינוי אחרי">
                <div className="pm-adjust-page__ba-card pm-adjust-page__ba-card--before">
                  <span>לפני ההתאמה</span>
                  <strong>{selectedRow.fromLabel}</strong>
                  <em dir="ltr">{fmtUsd(selectedRow.amountUsd)}</em>
                </div>
                <div className="pm-adjust-page__ba-arrow" aria-hidden>
                  <ArrowDown size={18} />
                </div>
                <div className="pm-adjust-page__ba-card pm-adjust-page__ba-card--change">
                  <span>השינוי</span>
                  <strong>
                    {selectedRow.fromLabel} → {selectedRow.toLabel}
                  </strong>
                  <em dir="ltr">{fmtUsd(selectedRow.amountUsd)}</em>
                </div>
                <div className="pm-adjust-page__ba-arrow" aria-hidden>
                  <ArrowDown size={18} />
                </div>
                <div className="pm-adjust-page__ba-card pm-adjust-page__ba-card--after">
                  <span>אחרי ההתאמה</span>
                  <strong>{selectedRow.toLabel}</strong>
                  <em dir="ltr">{fmtUsd(selectedRow.amountUsd)}</em>
                </div>
              </section>

              {hasRealBalanceSnapshot(selectedRow.details) ? (
                <section className="pm-adjust-page__detail-card">
                  <h4>יתרות אמצעי תשלום (בשעת ההתאמה)</h4>
                  <div className="pm-adjust-page__balances-grid">
                    <div>
                      <span>לפני — {selectedRow.fromLabel}</span>
                      <strong dir="ltr">
                        {selectedRow.details.sourceCurrency === "ILS"
                          ? fmtIls(selectedRow.details.beforeSourceBalance!)
                          : fmtUsd(selectedRow.details.beforeSourceBalance!)}
                      </strong>
                    </div>
                    <div>
                      <span>לפני — {selectedRow.toLabel}</span>
                      <strong dir="ltr">
                        {selectedRow.details.targetCurrency === "ILS"
                          ? fmtIls(selectedRow.details.beforeTargetBalance!)
                          : fmtUsd(selectedRow.details.beforeTargetBalance!)}
                      </strong>
                    </div>
                    <div className="pm-adjust-page__balances-delta">
                      <span>שינוי</span>
                      <strong dir="ltr">
                        −{fmtUsd(selectedRow.amountUsd)} {selectedRow.fromLabel}
                      </strong>
                      <strong dir="ltr">
                        +{fmtUsd(selectedRow.amountUsd)} {selectedRow.toLabel}
                      </strong>
                    </div>
                    <div>
                      <span>אחרי — {selectedRow.fromLabel}</span>
                      <strong dir="ltr">
                        {selectedRow.details.sourceCurrency === "ILS"
                          ? fmtIls(selectedRow.details.afterSourceBalance!)
                          : fmtUsd(selectedRow.details.afterSourceBalance!)}
                      </strong>
                    </div>
                    <div>
                      <span>אחרי — {selectedRow.toLabel}</span>
                      <strong dir="ltr">
                        {selectedRow.details.targetCurrency === "ILS"
                          ? fmtIls(selectedRow.details.afterTargetBalance!)
                          : fmtUsd(selectedRow.details.afterTargetBalance!)}
                      </strong>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="pm-adjust-page__detail-card">
                <h4>פירוט כספי ומטבע</h4>
                <div className="pm-adjust-page__money-meta">
                  <div>
                    <span>סכום ההתאמה</span>
                    <strong dir="ltr">{fmtUsd(selectedRow.amountUsd)} USD</strong>
                  </div>
                  <div>
                    <span>מטבע מקור</span>
                    <strong dir="ltr">{selectedRow.details.sourceCurrency ?? "USD"}</strong>
                  </div>
                  {selectedRow.details.sourceCurrency === "ILS" && selectedRow.details.amountOriginalCurrency ? (
                    <div>
                      <span>סכום מקורי</span>
                      <strong dir="ltr">{fmtIls(selectedRow.details.amountOriginalCurrency)}</strong>
                    </div>
                  ) : null}
                  {selectedRow.details.exchangeRate ? (
                    <div>
                      <span>שער המרה (בעת ההתאמה)</span>
                      <strong dir="ltr">{selectedRow.details.exchangeRate}</strong>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="pm-adjust-page__detail-card">
                <div className="pm-adjust-page__detail-table-head">
                  <h4>הזמנות שהושפעו</h4>
                  <StatusBadge reviewed={selectedRow.reviewed} />
                </div>
                <div className="pm-adjust-page__detail-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>הזמנה</th>
                        <th>לקוח</th>
                        <th>סכום</th>
                        <th>לפני</th>
                        <th>אחרי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRow.details.affectedOrders.map((order) => (
                        <tr key={order.orderId}>
                          <td dir="ltr">
                            <Link
                              href={`/admin/orders/${order.orderId}`}
                              className="pm-adjust-page__order-link"
                            >
                              {order.orderNumber}
                            </Link>
                          </td>
                          <td>{selectedRow.customerName}</td>
                          <td dir="ltr" className="pm-adjust-page__money-strong">
                            {fmtUsd(order.movedUsd)}
                          </td>
                          <td>{selectedRow.fromLabel}</td>
                          <td>{selectedRow.toLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="pm-adjust-page__detail-card">
                <h4>היסטוריית הפעולה</h4>
                {trailLoading ? (
                  <p className="pm-adjust-page__trail-empty">טוען היסטוריה...</p>
                ) : trail.length === 0 ? (
                  <p className="pm-adjust-page__trail-empty">אין רשומות Audit נוספות להצגה.</p>
                ) : (
                  <ol className="pm-adjust-page__trail">
                    {trail.map((event, idx) => (
                      <li key={`${event.atIso}-${idx}`}>
                        <div className="pm-adjust-page__trail-time" dir="ltr">
                          {fmtDateTime(event.atIso)}
                        </div>
                        <div className="pm-adjust-page__trail-body">
                          <strong>{event.title}</strong>
                          {event.detail ? <p>{event.detail}</p> : null}
                          {event.actorName ? <span>{event.actorName}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <div className="pm-adjust-page__detail-footer">
              {!selectedRow.reviewed ? (
                <button
                  type="button"
                  className="adm-btn adm-btn--primary"
                  disabled={marking}
                  onClick={() => void markReviewed()}
                >
                  סמן כנבדק
                </button>
              ) : null}
              <button type="button" className="adm-btn" onClick={() => setSelectedId(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
