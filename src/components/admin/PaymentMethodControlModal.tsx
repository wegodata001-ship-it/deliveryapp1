"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Eye, Pencil, RefreshCw, Search } from "lucide-react";
import {
  PAYMENT_VIEW_STATUS_META,
  summarizeIntakeMethodViews,
  type IntakeMethodView,
  type PaymentViewStatus,
} from "@/lib/payment-intake-order-analysis";
import { PAYMENT_BUCKET_LABELS, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";
import { summarizePaymentMethodLines } from "@/lib/finance-data/view-models";

function fmtMethodAmount(currency: "USD" | "ILS", n: number): string {
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "-" : "";
  return currency === "ILS" ? `${sign}₪${body}` : `${sign}$${body}`;
}

function fmtDualMoney(usd: number, ils: number): string {
  const parts: string[] = [];
  if (Math.abs(usd) > 0.005) parts.push(fmtMethodAmount("USD", usd));
  if (Math.abs(ils) > 0.005) parts.push(fmtMethodAmount("ILS", ils));
  return parts.length > 0 ? parts.join(" · ") : "$0.00";
}

const METHOD_FILTERS: { value: "" | PaymentBucketKey; label: string }[] = [
  { value: "", label: "כל האמצעים" },
  { value: "CASH", label: PAYMENT_BUCKET_LABELS.CASH },
  { value: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER },
  { value: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT },
  { value: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK },
  { value: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER },
];

const STATUS_FILTERS: { value: "" | PaymentViewStatus; label: string }[] = [
  { value: "", label: "כל הסטטוסים" },
  { value: "cleared", label: "הושלם" },
  { value: "partial", label: "חלקי" },
  { value: "pending", label: "ממתין" },
  { value: "open", label: "פתוח" },
  { value: "credit", label: "זכות לקוח" },
];

/**
 * Presentational only — rows from shared planning views (PaymentModalUpdated).
 * KPI cards, per-method summary, and table footer all derive from the exact
 * filtered table rows via Finance Data Layer summarizers — no parallel math.
 */
export function PaymentMethodControlModal({
  open,
  methodViews,
  onClose,
  onOrderEdit,
  onOrderView,
  onRefresh,
  refreshing = false,
  canEditOrders = false,
}: {
  open: boolean;
  methodViews: IntakeMethodView[];
  onClose: () => void;
  onOrderEdit?: (orderId: string) => void;
  onOrderView?: (orderId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  canEditOrders?: boolean;
}) {
  const [q, setQ] = useState("");
  const [methodFilter, setMethodFilter] = useState<"" | PaymentBucketKey>("");
  const [statusFilter, setStatusFilter] = useState<"" | PaymentViewStatus>("");
  const [dateFilter, setDateFilter] = useState("");

  const { tableRows, summary, methodSummary } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = methodViews.filter((r) => {
      if (needle && !r.orderNumber.toLowerCase().includes(needle)) return false;
      if (methodFilter && r.bucket !== methodFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (dateFilter && r.dateYmd !== dateFilter) return false;
      return true;
    });
    const methodSummary = summarizePaymentMethodLines(
      rows.map((r) => ({
        paymentMethod: r.bucket,
        label: r.methodLabel || PAYMENT_BUCKET_LABELS[r.bucket] || r.bucket,
        currency: (r.currency ?? "USD") === "ILS" ? "ILS" : "USD",
        planned: r.planned ?? r.plannedUsd,
        paid: r.paid ?? r.dbPaidUsd,
        remaining: r.remaining ?? r.dbRemainingUsd,
      })),
    );
    return {
      tableRows: rows,
      summary: summarizeIntakeMethodViews(rows),
      methodSummary,
    };
  }, [methodViews, q, methodFilter, statusFilter, dateFilter]);

  const dateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of methodViews) {
      if (r.dateYmd && r.dateYmd !== "—") set.add(r.dateYmd);
    }
    return [...set].sort();
  }, [methodViews]);

  if (!open) return null;

  return (
    <div className="pmc-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pmc-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pmc-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pmc-header">
          <div className="pmc-header__title">
            <h2 id="pmc-title">אמצעי תשלום מתוכננים</h2>
            <p>הכרטיסים, סיכום האמצעים והטבלה מאותן שורות · מתעדכן מיד עם כל שינוי</p>
          </div>
          <div className="pmc-header__actions">
            <button
              type="button"
              className="pmc-btn pmc-btn--ghost"
              disabled={refreshing || !onRefresh}
              onClick={() => onRefresh?.()}
            >
              <RefreshCw size={15} className={refreshing ? "pmc-spin" : undefined} aria-hidden />
              רענן
            </button>
            <button type="button" className="pmc-btn pmc-btn--primary" onClick={onClose}>
              סגור
            </button>
          </div>
        </header>

        <section className="pmc-summary" aria-label="סיכום כללי">
          <SummaryCard label="מספר הזמנות" value={String(summary.orderCount)} />
          <SummaryCard
            label="מתוכנן"
            value={fmtDualMoney(summary.plannedUsd, summary.plannedIls)}
          />
          <SummaryCard
            label="שולם"
            value={fmtDualMoney(summary.enteredUsd, summary.enteredIls)}
          />
          <SummaryCard
            label="נותר"
            value={fmtDualMoney(summary.remainingUsd, summary.remainingIls)}
            accent
          />
        </section>

        <section className="pmc-method-summary" aria-label="סיכום לפי אמצעי תשלום">
          <h3 className="pmc-method-summary__title">סיכום לפי אמצעי תשלום</h3>
          <div className="pmc-method-summary__wrap">
            <table className="pmc-method-summary__table">
              <thead>
                <tr>
                  <th>אמצעי תשלום</th>
                  <th className="pmc-num">מתוכנן</th>
                  <th className="pmc-num">שולם</th>
                  <th className="pmc-num">נותר</th>
                </tr>
              </thead>
              <tbody>
                {methodSummary.byMethod.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="pmc-empty">
                      אין אמצעים להצגה לפי הסינון הנוכחי.
                    </td>
                  </tr>
                ) : (
                  methodSummary.byMethod.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="pmc-method-summary__label">{m.label}</span>
                        <span className="pmc-method-summary__cur">
                          {m.currency === "ILS" ? "₪" : "$"}
                        </span>
                      </td>
                      <td className="pmc-num" dir="ltr">
                        {fmtMethodAmount(m.currency, m.planned)}
                      </td>
                      <td className="pmc-num" dir="ltr">
                        {fmtMethodAmount(m.currency, m.paid)}
                      </td>
                      <td
                        className={`pmc-num${m.remaining > 0.01 ? " pmc-rem" : ""}`}
                        dir="ltr"
                      >
                        {fmtMethodAmount(m.currency, m.remaining)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="pmc-method-summary__total">
                  <th scope="row">סה״כ</th>
                  <td className="pmc-num" dir="ltr">
                    {fmtDualMoney(methodSummary.totals.plannedUsd, methodSummary.totals.plannedIls)}
                  </td>
                  <td className="pmc-num" dir="ltr">
                    {fmtDualMoney(methodSummary.totals.paidUsd, methodSummary.totals.paidIls)}
                  </td>
                  <td className="pmc-num pmc-rem" dir="ltr">
                    {fmtDualMoney(
                      methodSummary.totals.remainingUsd,
                      methodSummary.totals.remainingIls,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="pmc-filters" aria-label="סינון">
          <label className="pmc-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              placeholder="חיפוש לפי מספר הזמנה"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as "" | PaymentBucketKey)}>
            {METHOD_FILTERS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | PaymentViewStatus)}
          >
            {STATUS_FILTERS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            <option value="">כל התאריכים</option>
            {dateOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </section>

        <div className="pmc-table-wrap">
          <table className="pmc-table">
            <thead>
              <tr>
                <th>מספר הזמנה</th>
                <th>אמצעי תשלום</th>
                <th>מטבע</th>
                <th className="pmc-num">מתוכנן</th>
                <th className="pmc-num">שולם</th>
                <th className="pmc-num">נותר</th>
                <th>סטטוס</th>
                <th>תאריך יעד</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr className="pmc-row pmc-row--empty">
                  <td colSpan={9} className="pmc-empty">
                    אין שורות להצגה לפי הסינון הנוכחי.
                  </td>
                </tr>
              ) : (
                tableRows.map((r, idx) => (
                  <GridRow
                    key={r.id}
                    row={r}
                    zebra={idx % 2 === 1}
                    canEditOrders={canEditOrders}
                    onOrderEdit={onOrderEdit}
                    onOrderView={onOrderView}
                    onRefreshRow={onRefresh}
                  />
                ))
              )}
            </tbody>
            {tableRows.length > 0 ? (
              <tfoot>
                <tr className="pmc-table-foot">
                  <th scope="row" colSpan={3}>
                    סה״כ (שורות מוצגות)
                  </th>
                  <td className="pmc-num" dir="ltr">
                    {fmtDualMoney(summary.plannedUsd, summary.plannedIls)}
                  </td>
                  <td className="pmc-num" dir="ltr">
                    {fmtDualMoney(summary.enteredUsd, summary.enteredIls)}
                  </td>
                  <td className="pmc-num pmc-rem" dir="ltr">
                    {fmtDualMoney(summary.remainingUsd, summary.remainingIls)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`pmc-card${accent ? " pmc-card--accent" : ""}`}>
      <span className="pmc-card__lbl">{label}</span>
      <strong className="pmc-card__val" dir="ltr">
        {value}
      </strong>
    </div>
  );
}

function GridRow({
  row,
  zebra,
  canEditOrders,
  onOrderEdit,
  onOrderView,
  onRefreshRow,
}: {
  row: IntakeMethodView;
  zebra: boolean;
  canEditOrders: boolean;
  onOrderEdit?: (orderId: string) => void;
  onOrderView?: (orderId: string) => void;
  onRefreshRow?: () => void;
}) {
  const hasOrder = Boolean(row.orderId);
  const meta = PAYMENT_VIEW_STATUS_META[row.status];

  return (
    <tr className={`pmc-row${zebra ? " pmc-row--zebra" : ""}`}>
      <td>
        {hasOrder && canEditOrders && onOrderEdit ? (
          <button
            type="button"
            className="pmc-order-link"
            title={`עריכת הזמנה ${row.orderNumber}`}
            onClick={() => onOrderEdit(row.orderId)}
          >
            <span dir="ltr">{row.orderNumber}</span>
            <ExternalLink size={12} aria-hidden />
          </button>
        ) : (
          <span dir="ltr">{row.orderNumber}</span>
        )}
      </td>
      <td>{row.methodLabel}</td>
      <td>{(row.currency ?? "USD") === "ILS" ? "₪ ILS" : "$ USD"}</td>
      <td className="pmc-num" dir="ltr">
        {fmtMethodAmount(row.currency ?? "USD", row.planned ?? row.plannedUsd)}
      </td>
      <td className="pmc-num" dir="ltr">
        {fmtMethodAmount(row.currency ?? "USD", row.paid ?? row.dbPaidUsd)}
      </td>
      <td className={`pmc-num${(row.remaining ?? row.dbRemainingUsd) > 0.01 ? " pmc-rem" : ""}`} dir="ltr">
        {fmtMethodAmount(row.currency ?? "USD", row.remaining ?? row.dbRemainingUsd)}
      </td>
      <td>
        <span className={`pmc-badge pmc-badge--${meta.tone}`}>{meta.label}</span>
      </td>
      <td dir="ltr">{row.dateYmd}</td>
      <td>
        <div className="pmc-row-actions">
          {hasOrder && canEditOrders && onOrderEdit ? (
            <button type="button" className="pmc-icon-btn" title="ערוך הזמנה" onClick={() => onOrderEdit(row.orderId)}>
              <Pencil size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="pmc-icon-btn"
            title="רענן"
            disabled={!onRefreshRow}
            onClick={() => onRefreshRow?.()}
          >
            <RefreshCw size={14} />
          </button>
          {hasOrder && onOrderView ? (
            <button type="button" className="pmc-icon-btn" title="צפייה בהזמנה" onClick={() => onOrderView(row.orderId)}>
              <Eye size={14} />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default PaymentMethodControlModal;
