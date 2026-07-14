"use client";

import { useState } from "react";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { formatIlsDisplay, formatUsdDisplay } from "@/lib/money-format";

export type SurplusDisposition = "credit" | "commission";

type Props = {
  open: boolean;
  preview: PaymentOveragePreview | null;
  busy?: boolean;
  onConfirm: (disposition: SurplusDisposition) => void;
  onCancel: () => void;
};

export function CustomerPaymentOverageModal({ open, preview, busy, onConfirm, onCancel }: Props) {
  const [choice, setChoice] = useState<SurplusDisposition>("credit");

  if (!open || !preview) return null;

  const surplusUsd = preview.surplusUsd;

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
          נוצר עודף בתשלום — {formatUsdDisplay(surplusUsd)}
        </h2>
        <p className="adm-payment-overage-lead">בחרו כיצד לטפל בעודף:</p>

        <div className="adm-payment-overage-options" role="radiogroup" aria-label="טיפול בעודף">
          <label className="adm-payment-overage-option">
            <input
              type="radio"
              name="surplus-disposition"
              value="credit"
              checked={choice === "credit"}
              onChange={() => setChoice("credit")}
            />
            <span>
              <strong>שמור כיתרת זכות ללקוח</strong>
              <small>ניתן להשתמש בעתיד · מופיע בכרטסת וביתרות</small>
            </span>
          </label>
          <label className="adm-payment-overage-option">
            <input
              type="radio"
              name="surplus-disposition"
              value="commission"
              checked={choice === "commission"}
              onChange={() => setChoice("commission")}
            />
            <span>
              <strong>הוסף לעמלות</strong>
              <small>העודף יישמר כהפרש התאמה · לא תיווצר יתרת זכות · ללא הקצאה נוספת</small>
            </span>
          </label>
        </div>

        <dl className="adm-payment-overage-stats">
          <div>
            <dt>יתרה פתוחה</dt>
            <dd dir="ltr">{formatIlsDisplay(preview.openDebtIls)}</dd>
          </div>
          <div>
            <dt>סכום תשלום</dt>
            <dd dir="ltr">{formatIlsDisplay(preview.paymentIls)}</dd>
          </div>
          <div className="adm-payment-overage-stats--surplus">
            <dt>עודף</dt>
            <dd dir="ltr">{formatIlsDisplay(preview.surplusIls)}</dd>
          </div>
        </dl>

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onCancel}>
            ביטול / הפחת סכום
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--primary"
            disabled={busy}
            onClick={() => onConfirm(choice)}
          >
            {busy ? "שומר…" : "אישור ושמירה"}
          </button>
        </div>
      </div>
    </div>
  );
}
