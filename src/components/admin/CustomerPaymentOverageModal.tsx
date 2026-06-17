"use client";

import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { formatIlsDisplay, formatUsdDisplay } from "@/lib/money-format";
import { Button } from "@/components/ui/Button";

type Props = {
  open: boolean;
  preview: PaymentOveragePreview | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CustomerPaymentOverageModal({ open, preview, busy, onConfirm, onCancel }: Props) {
  if (!open || !preview) return null;

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onCancel}>
      <div
        className="adm-mini-modal adm-payment-overage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-overage-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="payment-overage-title" className="adm-mini-modal-title">
          התשלום גבוה מהחוב ב-{formatUsdDisplay(preview.surplusUsd)}
        </h2>
        <p className="adm-payment-overage-lead">האם לשמור את ההפרש כיתרת זכות ללקוח?</p>
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
          {preview.surplusUsd > 0.01 ? (
            <div>
              <dt>עודף (USD)</dt>
              <dd dir="ltr">{formatUsdDisplay(preview.surplusUsd)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="adm-payment-overage-note">באישור: כל החובות הפתוחים ייסגרו ויתרת הזכות תירשם בכרטסת.</p>
        <div className="adm-mini-modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            ביטול / הפחת סכום
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? "שומר…" : "שמור כיתרת זכות"}
          </Button>
        </div>
      </div>
    </div>
  );
}
