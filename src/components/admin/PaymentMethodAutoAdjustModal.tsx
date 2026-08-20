"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Sparkles, X } from "lucide-react";
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

function MethodBadge({
  label,
  tone,
}: {
  label: string;
  tone: "from" | "to";
}) {
  return <span className={`payment-method-adjust-modal__method-badge payment-method-adjust-modal__method-badge--${tone}`}>{label}</span>;
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amount" | "from" | "to";
}) {
  return (
    <article className={`payment-method-adjust-modal__summary-card payment-method-adjust-modal__summary-card--${tone}`}>
      <span className="payment-method-adjust-modal__summary-label">{label}</span>
      <strong className="payment-method-adjust-modal__summary-value" dir={label === "סכום להתאמה" ? "ltr" : undefined}>
        {value}
      </strong>
    </article>
  );
}

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
  const fromLabel = PAYMENT_METHOD_LABELS[fromPaymentMethod] ?? fromPaymentMethod;
  const toLabel = PAYMENT_METHOD_LABELS[toPaymentMethod] ?? toPaymentMethod;
  const canProceed = reasonText.trim().length >= 5 && (reasonCode !== "OTHER" || reasonText.trim().length >= 10);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setErr(null);
      setConfirmOpen(false);
      setReasonText("");
      setReasonCode("CUSTOMER_REQUEST");
      setAmountUsd("");
      setFromPaymentMethod("CASH");
      setToPaymentMethod("BANK_TRANSFER");
    }
  }, [open]);

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
        className="adm-cash-modal payment-method-adjust-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-method-adjust-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-method-adjust-modal__head">
          <div>
            <h3 id="payment-method-adjust-title">התאמה אוטומטית של אמצעי תשלום</h3>
            <p>בדיקה ושינוי אמצעי התשלום המתוכנן בהזמנות הפתוחות</p>
          </div>
          <button type="button" className="payment-method-adjust-modal__close" aria-label="סגור" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="payment-method-adjust-modal__body">
          <section className="payment-method-adjust-modal__customer-card">
            <div>
              <span>לקוח</span>
              <strong>{customerName || "—"}</strong>
            </div>
            <div>
              <span>קוד לקוח</span>
              <strong dir="ltr">{customerCode || "—"}</strong>
            </div>
            <div>
              <span>חוב פתוח</span>
              <strong dir="ltr">{fmtUsd(openDebtUsd)}</strong>
            </div>
          </section>

          <section className="payment-method-adjust-modal__summary-strip">
            <SummaryStat label="סכום להתאמה" value={fmtUsd(amountNumber)} tone="amount" />
            <SummaryStat label="מאמצעי" value={fromLabel} tone="from" />
            <SummaryStat label="לאמצעי" value={toLabel} tone="to" />
          </section>

          <div className="payment-method-adjust-modal__direction" aria-live="polite">
            <MethodBadge label={fromLabel} tone="from" />
            <ArrowLeftRight size={16} aria-hidden />
            <MethodBadge label={toLabel} tone="to" />
            <span className="payment-method-adjust-modal__impact-note">
              {preview ? `${preview.affectedOrdersCount} הזמנות יושפעו מהשינוי` : "בחרו אמצעי, סכום וסקרו את השינוי לפני ביצוע"}
            </span>
          </div>

          <section className="payment-method-adjust-modal__form-card">
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
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  placeholder="35000"
                />
              </label>
              <button
                type="button"
                className="adm-btn adm-btn--primary payment-method-adjust-modal__calc-btn"
                disabled={busy != null}
                onClick={() => void runPreview()}
              >
                {busy === "preview" ? "מחשב התאמה..." : "חשב התאמה"}
              </button>
            </div>
          </section>

          {err ? <p className="payment-method-adjust-modal__err">{err}</p> : null}

          {preview ? (
            <>
              <section className="payment-method-adjust-modal__delta-card">
                <div>
                  <span>לפני</span>
                  <strong>
                    <span>{preview.fromLabel}</span>
                    <span dir="ltr">{fmtUsd(preview.currentFromOpenUsd)}</span>
                  </strong>
                </div>
                <div>
                  <span>שינוי</span>
                  <strong>
                    <span>{preview.fromLabel}</span>
                    <span dir="ltr">-{fmtUsd(preview.requestedAmountUsd)}</span>
                  </strong>
                </div>
                <div>
                  <span>אחרי</span>
                  <strong>
                    <span>{preview.toLabel}</span>
                    <span dir="ltr">{fmtUsd(preview.afterToOpenUsd)}</span>
                  </strong>
                </div>
              </section>

              <section className="payment-method-adjust-modal__table-card">
                <div className="payment-method-adjust-modal__table-head">
                  <div>
                    <h4>Preview להזמנות שיושפעו</h4>
                    <p>סה״כ התאמה: <strong dir="ltr">{fmtUsd(preview.requestedAmountUsd)}</strong></p>
                  </div>
                  <span className="payment-method-adjust-modal__table-count">{preview.affectedOrdersCount} הזמנות</span>
                </div>
                <div className="payment-method-adjust-modal__table-wrap">
                  <table className="payment-method-adjust-modal__table">
                    <thead>
                      <tr>
                        <th>הזמנה</th>
                        <th>יתרה לפני</th>
                        <th>שינוי</th>
                        <th>אמצעי קודם</th>
                        <th>אמצעי חדש</th>
                        <th>יתרה לאחר</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.affectedOrders.map((row) => (
                        <tr key={row.orderId}>
                          <td className="payment-method-adjust-modal__order-cell" dir="ltr">{row.orderNumber}</td>
                          <td dir="ltr">{fmtUsd(row.availableUsd)}</td>
                          <td className="payment-method-adjust-modal__money-strong" dir="ltr">{fmtUsd(row.moveUsd)}</td>
                          <td><MethodBadge label={row.currentMethodLabel} tone="from" /></td>
                          <td><MethodBadge label={row.newMethodLabel} tone="to" /></td>
                          <td dir="ltr">{fmtUsd(row.sourceRemainingAfterUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="payment-method-adjust-modal__reason-card">
                <h4>סיבת ההתאמה</h4>
                <label className="adm-field">
                  <span>סיבת השינוי <em>חובה</em></span>
                  <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as PaymentMethodAdjustmentReasonCode)}>
                    {PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.map((row) => (
                      <option key={row.code} value={row.code}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="adm-field">
                  <span>פירוט השינוי <em>חובה</em></span>
                  <textarea
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    rows={5}
                    placeholder="לדוגמה: הלקוח ביקש להעביר את יתרת התשלום ממזומן להעברה בנקאית"
                  />
                </label>
              </section>

              <section className={`payment-method-adjust-modal__confirm-card${confirmOpen ? " is-ready" : ""}`}>
                <Sparkles size={16} aria-hidden />
                <div>
                  <strong>
                    אתה עומד לשנות <span dir="ltr">{fmtUsd(preview.requestedAmountUsd)}</span> מ{preview.fromLabel} ל{preview.toLabel} ב־{preview.affectedOrdersCount} הזמנות.
                  </strong>
                  <p>השינוי יתועד ביומן הבקרה ולא ישנה תשלומים שכבר נקלטו.</p>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <div className="payment-method-adjust-modal__footer">
          <button type="button" className="adm-btn" disabled={busy != null} onClick={onClose}>
            ביטול
          </button>
          {preview ? (
            confirmOpen ? (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={busy === "apply" || !canProceed}
                onClick={() => void apply()}
              >
                {busy === "apply" ? "מבצע התאמה..." : "אישור וביצוע התאמה"}
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={!canProceed}
                onClick={() => setConfirmOpen(true)}
              >
                המשך לאישור
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
