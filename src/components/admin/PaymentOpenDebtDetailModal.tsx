"use client";

import type { PaymentIntakeMatchResult } from "@/lib/payment-intake";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  open: boolean;
  rows: PaymentIntakeMatchResult[];
  onClose: () => void;
  onOrderClick: (orderId: string) => void;
};

export function PaymentOpenDebtDetailModal({ open, rows, onClose, onOrderClick }: Props) {
  if (!open) return null;

  const openRows = rows.filter((r) => r.remainingAmount > 0.01);

  return (
    <div className="adm-oc-edit-request-backdrop" role="presentation" onClick={onClose}>
      <div
        className="payment-nav-confirm-modal payment-open-debt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-debt-modal-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <h4 id="open-debt-modal-title">פירוט חובות פתוחים</h4>
        <div className="payment-open-debt-modal__table-wrap">
          <table className="adm-table adm-table--dense payment-open-debt-modal__table">
            <thead>
              <tr>
                <th>מספר הזמנה</th>
                <th>תאריך</th>
                <th>סכום חוב</th>
                <th>עמלה</th>
                <th>יתרה</th>
              </tr>
            </thead>
            <tbody>
              {openRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>אין חובות פתוחים</td>
                </tr>
              ) : (
                openRows.map((r) => (
                  <tr
                    key={r.id}
                    className="adm-cust-module-row-click"
                    tabIndex={0}
                    role="button"
                    onClick={() => {
                      onClose();
                      onOrderClick(r.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onClose();
                        onOrderClick(r.id);
                      }
                    }}
                  >
                    <td dir="ltr">{r.orderNumber ?? "—"}</td>
                    <td dir="ltr">{r.dateYmd}</td>
                    <td dir="ltr">{formatUsdDisplay(r.amountUsd)}</td>
                    <td dir="ltr">{formatUsdDisplay(r.commissionUsd)}</td>
                    <td dir="ltr" className="payment-open-debt-modal__bal">
                      {formatUsdDisplay(r.remainingAmount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="payment-nav-confirm-actions">
          <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
