"use client";

import { useEffect, useState } from "react";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { formatOverpaymentUsdSigned } from "@/lib/payment-overpayment";
import { formatUsdDisplay } from "@/lib/money-format";

/** אפשרויות טיפול בעודף בתצוגה — יתרת זכות או עמלות בלבד */
export type SurplusDisposition = "credit" | "commission";

type Props = {
  open: boolean;
  preview: PaymentOveragePreview | null;
  busy?: boolean;
  /**
   * true = כל החוב נסגר ויש עודף — חלון "עודף לאחר סגירת חוב"
   * (לא חריגת אמצעי תשלום).
   */
  afterDebtClosure?: boolean;
  onConfirm: (disposition: SurplusDisposition) => void;
  onCancel: () => void;
};

export function CustomerPaymentOverageModal({
  open,
  preview,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [choice, setChoice] = useState<SurplusDisposition | null>(null);

  useEffect(() => {
    if (open) setChoice(null);
  }, [open]);

  if (!open || !preview) return null;

  const closesDebtUsd = preview.closesDebtUsd ?? Math.min(preview.paymentUsd, preview.openDebtUsd);
  const surplusUsd = preview.surplusUsd;
  const canConfirm = choice !== null && !busy;

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onCancel}>
      <div
        className="adm-mini-modal adm-payment-overage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-overage-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <h2 id="payment-overage-title" className="adm-mini-modal-title">
          תשלום גבוה מהחוב
        </h2>

        <dl className="adm-payment-overage-stats">
          <div>
            <dt>החוב הפתוח של הלקוח הוא</dt>
            <dd dir="ltr">{formatUsdDisplay(preview.openDebtUsd)}</dd>
          </div>
          <div>
            <dt>הוזן תשלום בסך</dt>
            <dd dir="ltr">{formatUsdDisplay(preview.paymentUsd)}</dd>
          </div>
          <div>
            <dt>סכום שיסגור את החוב</dt>
            <dd dir="ltr">{formatUsdDisplay(closesDebtUsd)}</dd>
          </div>
          <div className="adm-payment-overage-stats--overpayment">
            <dt>יתרה נוספת</dt>
            <dd dir="ltr">{formatOverpaymentUsdSigned(surplusUsd)}</dd>
          </div>
        </dl>

        <p className="adm-payment-overage-lead">כיצד ברצונך לטפל ביתרה?</p>

        <div className="adm-payment-overage-options" role="radiogroup" aria-label="טיפול בעודף">
          <label className="adm-payment-overage-option adm-payment-overage-option--card">
            <input
              type="radio"
              name="surplus-disposition"
              value="credit"
              checked={choice === "credit"}
              onChange={() => setChoice("credit")}
            />
            <span>
              <strong>צור יתרת זכות ללקוח</strong>
              <small>
                העודף יישמר בכרטיס הלקוח כיתרת זכות, וניתן יהיה לקזז אותו בתשלומים עתידיים.
              </small>
            </span>
          </label>
          <label className="adm-payment-overage-option adm-payment-overage-option--card">
            <input
              type="radio"
              name="surplus-disposition"
              value="commission"
              checked={choice === "commission"}
              onChange={() => setChoice("commission")}
            />
            <span>
              <strong>העבר לעמלות</strong>
              <small>
                העודף יירשם כהכנסה מעמלות ולא יישמר כיתרת זכות ללקוח.
              </small>
            </span>
          </label>
        </div>

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onCancel}>
            ביטול / הפחת סכום
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={!canConfirm}
            onClick={() => {
              if (choice) onConfirm(choice);
            }}
          >
            {busy ? "שומר…" : "אישור"}
          </button>
        </div>
      </div>
    </div>
  );
}
