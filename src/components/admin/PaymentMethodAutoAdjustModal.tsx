"use client";

import { useMemo, useState } from "react";
import {
  applyPaymentMethodAutoAdjustmentAction,
  previewPaymentMethodAutoAdjustmentAction,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import {
  PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS,
  type PaymentMethodAdjustmentPreview,
  type PaymentMethodAdjustmentReasonCode,
} from "@/lib/payment-method-auto-adjustment";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";

const METHOD_OPTIONS = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"] as const;

function fmtUsd(n: number | string): string {
  const value = typeof n === "string" ? Number(n) : n;
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Props = {
  open: boolean;
  customerId: string;
  customerName: string;
  customerCode: string | null;
  openDebtUsd: number;
  weekCode: string;
  workCountry: string;
  onClose: () => void;
  onApplied: (result: { adjustmentId: string; affectedOrders: number }) => void;
};

export function PaymentMethodAutoAdjustModal({
  open,
  customerId,
  customerName,
  customerCode,
  openDebtUsd,
  weekCode,
  workCountry,
  onClose,
  onApplied,
}: Props) {
  const [fromPaymentMethod, setFromPaymentMethod] = useState("CASH");
  const [toPaymentMethod, setToPaymentMethod] = useState("BANK_TRANSFER");
  const [amountUsd, setAmountUsd] = useState("");
  const [reasonCode, setReasonCode] = useState<PaymentMethodAdjustmentReasonCode>("CUSTOMER_REQUEST");
  const [reasonText, setReasonText] = useState("");
  const [preview, setPreview] = useState<PaymentMethodAdjustmentPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const amountNumber = useMemo(() => Number(amountUsd.replace(/,/g, "")) || 0, [amountUsd]);

  if (!open) return null;

  async function runPreview() {
    setBusy("preview");
    setErr(null);
    setConfirmOpen(false);
    const res = await previewPaymentMethodAutoAdjustmentAction({
      customerId,
      weekCode,
      workCountry,
      fromPaymentMethod,
      toPaymentMethod,
      amountUsd: amountNumber,
    });
    setBusy(null);
    if (!res.ok) {
      setPreview(null);
      setErr(res.error);
      return;
    }
    setPreview(res.preview);
  }

  async function apply() {
    setBusy("apply");
    setErr(null);
    const res = await applyPaymentMethodAutoAdjustmentAction({
      customerId,
      weekCode,
      workCountry,
      fromPaymentMethod,
      toPaymentMethod,
      amountUsd: amountNumber,
      reasonCode,
      reasonText,
    });
    setBusy(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setConfirmOpen(false);
    onApplied({ adjustmentId: res.adjustmentId, affectedOrders: res.affectedOrders });
  }

  return (
    <div className="adm-cash-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="adm-cash-modal adm-cash-modal--lg payment-method-adjust-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-method-adjust-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="adm-cash-modal__head">
          <h3 id="payment-method-adjust-title">התאמה אוטומטית של אמצעי תשלום</h3>
        </div>
        <div className="adm-cash-modal__body">
          <div className="payment-method-adjust-modal__summary">
            <div><strong>לקוח:</strong> {customerName || "—"}</div>
            <div><strong>קוד לקוח:</strong> <span dir="ltr">{customerCode || "—"}</span></div>
            <div><strong>חוב פתוח:</strong> <span dir="ltr">{fmtUsd(openDebtUsd)}</span></div>
          </div>

          <div className="payment-method-adjust-modal__form">
            <label className="adm-field">
              <span>מאמצעי תשלום</span>
              <select value={fromPaymentMethod} onChange={(e) => setFromPaymentMethod(e.target.value)}>
                {METHOD_OPTIONS.map((value) => (
                  <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value] ?? value}</option>
                ))}
              </select>
            </label>
            <label className="adm-field">
              <span>לאמצעי תשלום</span>
              <select value={toPaymentMethod} onChange={(e) => setToPaymentMethod(e.target.value)}>
                {METHOD_OPTIONS.map((value) => (
                  <option key={value} value={value}>{PAYMENT_METHOD_LABELS[value] ?? value}</option>
                ))}
              </select>
            </label>
            <label className="adm-field">
              <span>סכום לשינוי</span>
              <input dir="ltr" inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="35000" />
            </label>
            <button type="button" className="adm-btn adm-btn--primary" disabled={busy != null} onClick={() => void runPreview()}>
              {busy === "preview" ? "מחשב…" : "חשב התאמה"}
            </button>
          </div>

          {err ? <p className="payment-method-adjust-modal__err">{err}</p> : null}

          {preview ? (
            <>
              <div className="payment-method-adjust-modal__totals">
                <div><strong>לפני:</strong> {preview.fromLabel} <span dir="ltr">{fmtUsd(preview.currentFromOpenUsd)}</span> | {preview.toLabel} <span dir="ltr">{fmtUsd(preview.currentToOpenUsd)}</span></div>
                <div><strong>שינוי:</strong> {preview.fromLabel} <span dir="ltr">-{fmtUsd(preview.requestedAmountUsd)}</span> | {preview.toLabel} <span dir="ltr">+{fmtUsd(preview.requestedAmountUsd)}</span></div>
                <div><strong>אחרי:</strong> {preview.fromLabel} <span dir="ltr">{fmtUsd(preview.afterFromOpenUsd)}</span> | {preview.toLabel} <span dir="ltr">{fmtUsd(preview.afterToOpenUsd)}</span></div>
                <div><strong>הזמנות שיושפעו:</strong> {preview.affectedOrdersCount}</div>
              </div>

              <div className="payment-method-adjust-modal__table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>הזמנה</th>
                      <th>יתרה זמינה</th>
                      <th>אמצעי נוכחי</th>
                      <th>סכום שיוחלף</th>
                      <th>אמצעי חדש</th>
                      <th>יתרה באמצעי המקורי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.affectedOrders.map((row) => (
                      <tr key={row.orderId}>
                        <td dir="ltr">{row.orderNumber}</td>
                        <td dir="ltr">{fmtUsd(row.availableUsd)}</td>
                        <td>{row.currentMethodLabel}</td>
                        <td dir="ltr">{fmtUsd(row.moveUsd)}</td>
                        <td>{row.newMethodLabel}</td>
                        <td dir="ltr">{fmtUsd(row.sourceRemainingAfterUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <label className="adm-field">
                <span>סיבת ההתאמה</span>
                <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as PaymentMethodAdjustmentReasonCode)}>
                  {PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.map((row) => (
                    <option key={row.code} value={row.code}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label className="adm-field">
                <span>פירוט השינוי</span>
                <textarea
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  rows={4}
                  placeholder="הלקוח ביקש להעביר $35,000 מהיתרה במזומן לתשלום באמצעות העברה בנקאית."
                />
              </label>

              {confirmOpen ? (
                <div className="payment-method-adjust-modal__confirm">
                  אתה עומד לשנות <span dir="ltr">{fmtUsd(preview.requestedAmountUsd)}</span> מ{preview.fromLabel} ל{preview.toLabel} ב־{preview.affectedOrdersCount} הזמנות.
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="adm-cash-modal__foot">
          <button type="button" className="adm-btn" disabled={busy != null} onClick={onClose}>ביטול</button>
          {preview ? (
            confirmOpen ? (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={busy === "apply" || reasonText.trim().length < 5 || (reasonCode === "OTHER" && reasonText.trim().length < 10)}
                onClick={() => void apply()}
              >
                {busy === "apply" ? "מבצע…" : "אישור וביצוע"}
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={reasonText.trim().length < 5 || (reasonCode === "OTHER" && reasonText.trim().length < 10)}
                onClick={() => setConfirmOpen(true)}
              >
                בצע התאמה אוטומטית
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
