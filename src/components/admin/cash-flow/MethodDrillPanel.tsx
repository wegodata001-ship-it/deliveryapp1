"use client";

import { Eye, Paperclip } from "lucide-react";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-actions";
import { METHOD_ICON, num } from "@/components/admin/cash-flow/shared";

export type MethodDrillPanelProps = {
  method: CashDailyMethodId;
  methodLabel: string | undefined;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
  reviewBusy: string | null;
  onOpenPayment: (paymentId: string) => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
};

/** פירוט אמצעי תשלום נבחר — נטען רק בלחיצה (Drill Down) */
export function MethodDrillPanel({
  method,
  methodLabel,
  loading,
  rows,
  reviewBusy,
  onOpenPayment,
  onToggleReviewed,
}: MethodDrillPanelProps) {
  const cur = method === "CASH_USD" ? "USD" : "ILS";
  return (
    <section className="cc-block cc-block--detail cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--white" aria-hidden>{METHOD_ICON[method]}</span>
          פירוט {methodLabel}
        </div>
        <span className="cc-block__note">לחיצה על שורה פותחת את קליטת התשלום</span>
      </header>
      {loading ? (
        <p className="cc-loading">טוען…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="cc-empty">אין קליטות</p>
      ) : (
        <div className="cc-block__scroll">
          <table className="cc-table cc-table--detail">
            <thead>
              <tr>
                <th>שעה</th>
                <th>מספר קליטה</th>
                <th>לקוח</th>
                <th>עובד</th>
                <th className="cc-num">סכום</th>
                <th>📎 מסמך</th>
                <th>✔ נבדק</th>
                <th>👁 צפייה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.paymentId}
                  className={`cc-detail-row${r.reviewed ? " is-reviewed" : ""}`}
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
                  <td dir="ltr" className="cc-num">{fmtDailyMoney(cur, num(r.amount))}</td>
                  <td className="cc-icon-cell">
                    {r.hasDocument ? <Paperclip size={14} aria-hidden /> : <span className="cc-muted">—</span>}
                  </td>
                  <td className="cc-icon-cell" onClick={(e) => e.stopPropagation()}>
                    <label className="cc-check">
                      <input
                        type="checkbox"
                        checked={r.reviewed}
                        disabled={reviewBusy === r.paymentId}
                        onChange={(ev) => onToggleReviewed(r.paymentId, ev.target.checked)}
                      />
                      {r.reviewed ? "☑" : "☐"}
                    </label>
                  </td>
                  <td className="cc-icon-cell">
                    <Eye size={14} aria-hidden />
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

export default MethodDrillPanel;
