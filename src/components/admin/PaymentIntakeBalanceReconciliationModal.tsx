"use client";

import {
  formatBridgeAmountUsd,
  type PaymentIntakeBalanceBridge,
} from "@/lib/payment-intake-balance-bridge-shared";

export function PaymentIntakeBalanceReconciliationModal({
  open,
  bridge,
  loading,
  error,
  weekLabel,
  onClose,
}: {
  open: boolean;
  bridge: PaymentIntakeBalanceBridge | null;
  loading?: boolean;
  error?: string | null;
  weekLabel?: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="payment-bridge-backdrop" role="presentation" onClick={onClose}>
      <div
        className="payment-bridge-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-bridge-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="payment-bridge-modal__head">
          <div>
            <h2 id="payment-bridge-title">פירוט התאמת יתרות</h2>
            <p className="payment-bridge-modal__sub">
              הסבר חשבונאי — חוב CURRENT לעומת יתרות הזמנות בשבוע הגבייה
              {weekLabel ? ` (${weekLabel})` : ""}
            </p>
          </div>
          <button type="button" className="payment-bridge-modal__close" onClick={onClose}>
            סגור
          </button>
        </header>

        {loading ? (
          <p className="payment-bridge-modal__status">טוען נתונים…</p>
        ) : error ? (
          <p className="payment-bridge-modal__status payment-bridge-modal__status--err">{error}</p>
        ) : bridge ? (
          <div className="payment-bridge-modal__body">
            <table className="payment-bridge-table">
              <thead>
                <tr>
                  <th scope="col">רכיב</th>
                  <th scope="col" className="payment-bridge-table__num">
                    סכום
                  </th>
                </tr>
              </thead>
              <tbody>
                {bridge.rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.label}
                      {row.detail ? (
                        <span className="payment-bridge-table__detail" dir="ltr">
                          {row.detail}
                        </span>
                      ) : null}
                    </td>
                    <td className="payment-bridge-table__num" dir="ltr">
                      {row.unverified && row.amountUsd == null
                        ? "נדרשת בדיקת התאמה"
                        : formatBridgeAmountUsd(row.amountUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="payment-bridge-modal__note">
              הטבלה מציגה קשר בין מדדים — לא נוסחת חיסור רציפה של כל השורות.
            </p>
          </div>
        ) : (
          <p className="payment-bridge-modal__status">אין נתונים להצגה</p>
        )}
      </div>
    </div>
  );
}
