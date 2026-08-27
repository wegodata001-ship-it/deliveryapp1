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

  const applyUsd = Math.min(creditUsd, requiredUsd);
  const remainingToPayUsd = Math.max(0, requiredUsd - applyUsd);
  const creditAfterUsd = Math.max(0, creditUsd - applyUsd);

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
          שימוש ביתרת זכות
        </h2>
        <dl className="adm-balance-reset-credit-stats">
          <div>
            <dt>יתרת זכות זמינה</dt>
            <dd dir="ltr">{formatUsdDisplay(creditUsd)}</dd>
          </div>
          <div>
            <dt>נותר לסגירה לאחר התשלום בטופס</dt>
            <dd dir="ltr">{formatUsdDisplay(requiredUsd)}</dd>
          </div>
          <div className="adm-balance-reset-credit-stats--apply">
            <dt>יוחל מיתרת זכות</dt>
            <dd dir="ltr" className="adm-payment-fee-amt--credit">
              {formatUsdDisplay(applyUsd)}
            </dd>
          </div>
          <div>
            <dt>יישאר לתשלום</dt>
            <dd dir="ltr">{formatUsdDisplay(remainingToPayUsd)}</dd>
          </div>
          <div className="adm-balance-reset-credit-stats--after">
            <dt>יתרת זכות אחרי</dt>
            <dd dir="ltr">{formatUsdDisplay(creditAfterUsd)}</dd>
          </div>
        </dl>
        <p className="adm-muted-keys adm-balance-reset-credit-note">
          הקיזוז יוחל בשמירת קליטת התשלום — ללא שינוי סכומי ההזמנה.
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
