"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, FilterX, RefreshCw, X } from "lucide-react";
import {
  listPaymentMethodAutoAdjustmentsAction,
  markPaymentMethodAutoAdjustmentReviewedAction,
  type PaymentMethodAdjustmentAdminRow,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import { PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS } from "@/lib/payment-method-auto-adjustment";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL");
}

function fmtDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fmtUsd(amount: string): string {
  return `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reasonLabel(code: string): string {
  return PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.find((row) => row.code === code)?.label ?? code;
}

function MethodBadge({ label, tone }: { label: string; tone: "from" | "to" }) {
  return <span className={`pm-adjust-page__method-badge pm-adjust-page__method-badge--${tone}`}>{label}</span>;
}

function DetailLine({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="pm-adjust-page__detail-line">
      <span>{label}</span>
      <strong dir={ltr ? "ltr" : undefined}>{value}</strong>
    </div>
  );
}

export function PaymentMethodAdjustmentsClient() {
  const [rows, setRows] = useState<PaymentMethodAdjustmentAdminRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

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
    const today = new Date().toISOString().slice(0, 10);
    const todaysRows = filteredRows.filter((row) => fmtDateInput(row.createdAtIso) === today);
    const amountToday = todaysRows.reduce((sum, row) => sum + Number(row.amountUsd), 0);
    const ordersToday = todaysRows.reduce((sum, row) => sum + row.affectedOrdersCount, 0);
    const mostCommonTarget = filteredRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.toLabel] = (acc[row.toLabel] ?? 0) + 1;
      return acc;
    }, {});
    const topTarget =
      Object.entries(mostCommonTarget).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    return {
      todayCount: todaysRows.length,
      todayAmount: amountToday.toFixed(2),
      ordersToday,
      topTarget,
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

  return (
    <div className="pm-adjust-page adm-page--page-scroll">
      <section className="pm-adjust-page__hero">
        <div>
          <h1 className="adm-page-title adm-page-title--sm">התאמות אמצעי תשלום</h1>
          <p className="adm-order-detail-sub">בקרה ואודיט להתאמות אוטומטיות שבוצעו בקליטת תשלום.</p>
        </div>
        <button type="button" className="adm-btn" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} aria-hidden />
          רענן
        </button>
      </section>

      <section className="pm-adjust-page__kpis">
        <article className="pm-adjust-page__kpi">
          <span>התאמות היום</span>
          <strong>{kpis.todayCount}</strong>
        </article>
        <article className="pm-adjust-page__kpi">
          <span>סכום שהותאם היום</span>
          <strong dir="ltr">{fmtUsd(kpis.todayAmount)}</strong>
        </article>
        <article className="pm-adjust-page__kpi">
          <span>הזמנות שהושפעו</span>
          <strong>{kpis.ordersToday}</strong>
        </article>
        <article className="pm-adjust-page__kpi">
          <span>אמצעי נפוץ בשינויים</span>
          <strong>{kpis.topTarget}</strong>
        </article>
      </section>

      <section className="pm-adjust-page__filters">
        <label className="adm-field">
          <span>חיפוש לקוח / קוד</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="שם לקוח או #קוד" />
        </label>
        <label className="adm-field">
          <span>מתאריך</span>
          <input type="date" dir="ltr" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="adm-field">
          <span>עד תאריך</span>
          <input type="date" dir="ltr" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="adm-field">
          <span>מאמצעי</span>
          <select value={fromFilter} onChange={(e) => setFromFilter(e.target.value)}>
            <option value="">הכול</option>
            {fromOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>לאמצעי</span>
          <select value={toFilter} onChange={(e) => setToFilter(e.target.value)}>
            <option value="">הכול</option>
            {toOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>עובד</span>
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">הכול</option>
            {employeeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>סטטוס</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">הכול</option>
            <option value="new">חדש</option>
            <option value="reviewed">נבדק</option>
          </select>
        </label>
        <button type="button" className="adm-btn" onClick={clearFilters}>
          <FilterX size={15} aria-hidden />
          נקה סינונים
        </button>
      </section>

      {err ? <p className="adm-inline-error">{err}</p> : null}

      <section className="pm-adjust-page__table-card">
        <div className="pm-adjust-page__table-head">
          <div>
            <h2>רשימת התאמות</h2>
            <p>{filteredRows.length} רשומות מוצגות כרגע</p>
          </div>
        </div>

        <div className="pm-adjust-page__table-wrap">
          <table className="adm-table pm-adjust-page__table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>עובד</th>
                <th>לקוח</th>
                <th>שינוי אמצעי</th>
                <th>סכום</th>
                <th>הזמנות</th>
                <th>סיבה</th>
                <th>סטטוס</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="adm-table-empty">אין התאמות אמצעי תשלום להצגה.</td>
                </tr>
              ) : filteredRows.map((row) => (
                <tr key={row.id}>
                  <td dir="ltr">{fmtDateTime(row.createdAtIso)}</td>
                  <td>{row.employeeName}</td>
                  <td>
                    <strong>{row.customerName}</strong>
                    {row.customerCode ? <div dir="ltr" className="pm-adjust-page__customer-code">#{row.customerCode}</div> : null}
                  </td>
                  <td>
                    <div className="pm-adjust-page__method-flow">
                      <MethodBadge label={row.fromLabel} tone="from" />
                      <span aria-hidden>→</span>
                      <MethodBadge label={row.toLabel} tone="to" />
                    </div>
                  </td>
                  <td className="pm-adjust-page__money-strong" dir="ltr">{fmtUsd(row.amountUsd)}</td>
                  <td>{row.affectedOrdersCount}</td>
                  <td>{reasonLabel(row.details.reasonCode)}</td>
                  <td>
                    <span className={`pm-adjust-page__status-badge${row.reviewed ? " is-reviewed" : " is-new"}`}>
                      {row.reviewed ? "נבדק" : "חדש"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="adm-btn" onClick={() => setSelectedId(row.id)}>
                      <Eye size={15} aria-hidden />
                      צפייה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pm-adjust-page__cards">
          {filteredRows.map((row) => (
            <article key={row.id} className="pm-adjust-page__mobile-card">
              <div className="pm-adjust-page__mobile-head">
                <div>
                  <strong>{row.customerName}</strong>
                  {row.customerCode ? <div dir="ltr" className="pm-adjust-page__customer-code">#{row.customerCode}</div> : null}
                </div>
                <span className={`pm-adjust-page__status-badge${row.reviewed ? " is-reviewed" : " is-new"}`}>
                  {row.reviewed ? "נבדק" : "חדש"}
                </span>
              </div>
              <div className="pm-adjust-page__method-flow">
                <MethodBadge label={row.fromLabel} tone="from" />
                <span aria-hidden>→</span>
                <MethodBadge label={row.toLabel} tone="to" />
              </div>
              <p dir="ltr" className="pm-adjust-page__money-strong">{fmtUsd(row.amountUsd)}</p>
              <button type="button" className="adm-btn" onClick={() => setSelectedId(row.id)}>
                <Eye size={15} aria-hidden />
                צפייה
              </button>
            </article>
          ))}
        </div>
      </section>

      {selectedRow ? (
        <div className="adm-cash-modal-backdrop" role="presentation" onClick={() => setSelectedId(null)}>
          <div className="adm-cash-modal pm-adjust-page__detail-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="pm-adjust-page__detail-head">
              <div>
                <h3>פרטי התאמה</h3>
                <p>צפייה מלאה בנתוני ההתאמה וההזמנות שהושפעו.</p>
              </div>
              <button type="button" className="pm-adjust-page__detail-close" aria-label="סגור" onClick={() => setSelectedId(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="pm-adjust-page__detail-body">
              <section className="pm-adjust-page__detail-grid">
                <DetailLine label="תאריך ושעה" value={fmtDateTime(selectedRow.createdAtIso)} ltr />
                <DetailLine label="עובד" value={selectedRow.employeeName} />
                <DetailLine label="לקוח" value={selectedRow.customerName} />
                <DetailLine label="קוד לקוח" value={selectedRow.customerCode ? `#${selectedRow.customerCode}` : "—"} ltr />
                <DetailLine label="סכום כולל" value={fmtUsd(selectedRow.amountUsd)} ltr />
                <DetailLine label="מספר הזמנות" value={String(selectedRow.affectedOrdersCount)} />
              </section>

              <section className="pm-adjust-page__detail-flow">
                <MethodBadge label={selectedRow.fromLabel} tone="from" />
                <span aria-hidden>→</span>
                <MethodBadge label={selectedRow.toLabel} tone="to" />
              </section>

              <section className="pm-adjust-page__detail-card">
                <h4>סיבה</h4>
                <p>{reasonLabel(selectedRow.details.reasonCode)}</p>
                <h4>פירוט</h4>
                <p>{selectedRow.reasonText}</p>
              </section>

              <section className="pm-adjust-page__detail-card">
                <div className="pm-adjust-page__detail-table-head">
                  <h4>הזמנות שהושפעו</h4>
                  {!selectedRow.reviewed ? (
                    <button
                      type="button"
                      className="adm-btn adm-btn--primary"
                      onClick={async () => {
                        const res = await markPaymentMethodAutoAdjustmentReviewedAction(selectedRow.id);
                        if (res.ok) {
                          setSelectedId(null);
                          void load();
                        }
                      }}
                    >
                      סמן כנבדק
                    </button>
                  ) : null}
                </div>
                <div className="pm-adjust-page__detail-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>מספר הזמנה</th>
                        <th>לפני</th>
                        <th>שינוי</th>
                        <th>אחרי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRow.details.affectedOrders.map((order) => (
                        <tr key={order.orderId}>
                          <td dir="ltr"><strong>{order.orderNumber}</strong></td>
                          <td dir="ltr">
                            {order.beforeAllocation.map((line) => `${PAYMENT_METHOD_LABELS[line.paymentMethod] ?? line.paymentMethod} ${line.amount}`).join(" | ") || "—"}
                          </td>
                          <td dir="ltr" className="pm-adjust-page__money-strong">{fmtUsd(order.movedUsd)}</td>
                          <td dir="ltr">
                            {order.afterAllocation.map((line) => `${PAYMENT_METHOD_LABELS[line.paymentMethod] ?? line.paymentMethod} ${line.amount}`).join(" | ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
