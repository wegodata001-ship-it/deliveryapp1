"use client";

import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  open: boolean;
  creditUsd: number;
  requiredUsd: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function BalanceResetCreditConfirmModal({
  open,
  creditUsd,
  requiredUsd,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const afterUsd = Math.max(0, creditUsd - requiredUsd);

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onCancel}>
      <div
        className="adm-mini-modal adm-balance-reset-credit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="balance-reset-credit-title"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <h2 id="balance-reset-credit-title" className="adm-mini-modal-title">
          איפוס יתרה מתוך יתרת זכות
        </h2>
        <dl className="adm-balance-reset-credit-stats">
          <div>
            <dt>ללקוח קיימת יתרת זכות</dt>
            <dd dir="ltr">{formatUsdDisplay(creditUsd)}</dd>
          </div>
          <div>
            <dt>נדרש לאפס</dt>
            <dd dir="ltr">{formatUsdDisplay(requiredUsd)}</dd>
          </div>
          <div className="adm-balance-reset-credit-stats--after">
            <dt>לאחר האיפוס תישאר יתרת זכות</dt>
            <dd dir="ltr">{formatUsdDisplay(afterUsd)}</dd>
          </div>
        </dl>
        <p className="adm-muted-keys adm-balance-reset-credit-note">
          האיפוס יוחל רק בשמירת קליטת התשלום.
        </p>
        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onCancel}>
            ביטול
          </button>
          <button type="button" className="adm-btn adm-btn--primary" onClick={onConfirm}>
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
