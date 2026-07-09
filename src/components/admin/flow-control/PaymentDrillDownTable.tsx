"use client";

import { Check, Eye, ExternalLink, Paperclip } from "lucide-react";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { CASH_DAILY_METHODS } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type PaymentDrillDownTableProps = {
  method: CashDailyMethodId;
  dateLabel: string;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
  reviewBusy: string | null;
  onOpenPayment: (paymentId: string) => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
};

export function PaymentDrillDownTable({
  method,
  dateLabel,
  loading,
  rows,
  reviewBusy,
  onOpenPayment,
  onToggleReviewed,
}: PaymentDrillDownTableProps) {
  const cur = method === "CASH_USD" ? "USD" : "ILS";
  const methodLabel = CASH_DAILY_METHODS.find((m) => m.id === method)?.label ?? method;

  return (
    <section className="fc-drill">
      <header className="fc-drill__head">
        <h3>
          פירוט {methodLabel} — {dateLabel}
        </h3>
        <span className="fc-drill__hint">לחיצה על שורה פותחת את קליטת התשלום</span>
      </header>
      {loading ? (
        <p className="fc-muted">טוען…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="fc-muted">אין קליטות</p>
      ) : (
        <div className="fc-table-wrap">
          <table className="fc-table fc-table--detail">
            <thead>
              <tr>
                <th>שעה</th>
                <th>מספר קליטה</th>
                <th>לקוח</th>
                <th>עובד</th>
                <th>מסמך</th>
                <th>אמצעי תשלום</th>
                <th className="fc-num">סכום</th>
                <th>קבצים</th>
                <th>סטטוס בדיקה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.paymentId}
                  className={`fc-detail-row${r.reviewed ? " is-reviewed" : ""}`}
                  onClick={() => onOpenPayment(r.paymentId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onOpenPayment(r.paymentId);
                  }}
                >
                  <td dir="ltr">{r.timeHm}</td>
                  <td dir="ltr">{r.paymentCode ?? "—"}</td>
                  <td>{r.customerName ?? "—"}</td>
                  <td>{r.recordedByName ?? "—"}</td>
                  <td>{methodLabel}</td>
                  <td dir="ltr" className="fc-num">
                    {fmtDailyMoney(cur, fcNum(r.amount))}
                  </td>
                  <td className="fc-icon-cell">
                    {r.hasDocument ? <Paperclip size={14} /> : <span className="fc-muted">—</span>}
                  </td>
                  <td className="fc-icon-cell" onClick={(e) => e.stopPropagation()}>
                    <label className="fc-check" title="נבדק">
                      <input
                        type="checkbox"
                        checked={r.reviewed}
                        disabled={reviewBusy === r.paymentId}
                        onChange={(ev) => onToggleReviewed(r.paymentId, ev.target.checked)}
                      />
                      <Check size={14} className={r.reviewed ? "is-on" : "is-off"} />
                    </label>
                  </td>
                  <td className="fc-icon-cell">
                    <button
                      type="button"
                      className="fc-iconbtn"
                      title="פתיחת קליטה"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPayment(r.paymentId);
                      }}
                    >
                      <ExternalLink size={14} />
                    </button>
                    <Eye size={14} className="fc-muted-icon" aria-hidden />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default PaymentDrillDownTable;
