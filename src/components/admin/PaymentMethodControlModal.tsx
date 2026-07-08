"use client";

import {
  fmtMethodControlCell,
  type LivePaymentMethodControlRow,
} from "@/lib/payment-intake-method-control";

export function PaymentMethodControlModal({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: LivePaymentMethodControlRow[];
  onClose: () => void;
}) {
  if (!open) return null;

  const visibleRows = rows.filter((r) => r.status !== "not-required" || r.enteredUsd > 0);

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--md payment-method-control-modal"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="payment-method-control-title"
      >
        <div className="adm-cash-modal__head">
          <h3 id="payment-method-control-title">אמצעי תשלום מתוכננים</h3>
          <button type="button" className="adm-modal__close" onClick={onClose} aria-label="סגור">
            ×
          </button>
        </div>
        <div className="adm-cash-modal__body">
          <p className="payment-method-control-modal__hint">
            מתעדכן בזמן אמת לפי ההקלדה — נקלט = סכום בטופס הנוכחי בלבד.
          </p>
          <div className="payment-upd-composite-scroll">
            <table className="payment-upd-composite-tbl payment-method-control-modal__tbl">
              <thead>
                <tr>
                  <th>אמצעי</th>
                  <th>תוכנן</th>
                  <th>נקלט</th>
                  <th>נותר</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="adm-table-empty">
                      אין אמצעי תשלום מתוכננים להזמנות שנבחרו.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r) => (
                    <tr key={r.bucket} className={`payment-upd-composite-row is-${r.status}`}>
                      <td className="payment-upd-composite-method">{r.label}</td>
                      <td dir="ltr" className="payment-upd-composite-num">
                        {fmtMethodControlCell(r, "planned")}
                      </td>
                      <td dir="ltr" className="payment-upd-composite-num">
                        {fmtMethodControlCell(r, "entered")}
                      </td>
                      <td
                        dir="ltr"
                        className={`payment-upd-composite-num payment-upd-composite-rem-cell${r.status === "excess" ? " is-excess" : ""}${r.status === "surplus" ? " is-surplus" : ""}`}
                      >
                        {fmtMethodControlCell(r, "remaining")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.status === "excess") ? (
            <p className="payment-method-control-modal__warn">⚠️ קיימת חריגה בין ההקלדה לחלוקה המתוכננת</p>
          ) : rows.some((r) => r.status === "surplus") ? (
            <p className="payment-method-control-modal__info">ℹ️ קיים עודף תשלום — לאחר השמירה תוצג בחירה לטיפול בעודף</p>
          ) : rows.some((r) => r.status === "remaining") ? (
            <p className="payment-method-control-modal__info">ℹ️ נותרה יתרה פתוחה — אמצעי התשלום תואם. ניתן לשמור חלקית או לאפס יתרה.</p>
          ) : null}
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-btn adm-btn--primary" onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
