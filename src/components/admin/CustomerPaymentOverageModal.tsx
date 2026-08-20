"use client";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import { formatOverpaymentUsdSigned } from "@/lib/payment-overpayment";
import { formatUsdDisplay } from "@/lib/money-format";

/** אפשרויות טיפול בעודף בתצוגה — יתרת זכות או עמלות בלבד */
export type SurplusDisposition = "credit" | "commission";

type Props = {
  open: boolean;
  preview: PaymentOveragePreview | null;
  commissionBalanceUsd?: number;
  busy?: boolean;
  /**
   * true = כל החוב נסגר ויש עודף — חלון "עודף לאחר סגירת חוב"
   * (לא חריגת אמצעי תשלום).
   */
  afterDebtClosure?: boolean;
  onConfirm: (disposition: SurplusDisposition) => void;
  onEditOrder?: () => void;
  onCancel: () => void;
};

export function CustomerPaymentOverageModal({
  open,
  preview,
  commissionBalanceUsd = 0,
  busy,
  onConfirm,
  onEditOrder,
  onCancel,
}: Props) {
  if (!open || !preview) return null;

  const closesDebtUsd = preview.closesDebtUsd ?? Math.min(preview.paymentUsd, preview.openDebtUsd);
  const surplusUsd = preview.surplusUsd;
  const commissionAfterUsd = commissionBalanceUsd + surplusUsd;

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
          התקבל תשלום יתר
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
            <dt>תשלום יתר</dt>
            <dd dir="ltr">{formatOverpaymentUsdSigned(surplusUsd)}</dd>
          </div>
        </dl>

        <p className="adm-payment-overage-lead">
          התקבלו <strong dir="ltr">{formatOverpaymentUsdSigned(surplusUsd)}</strong> יותר מהחוב הפתוח.
          <br />
          מה לעשות עם ההפרש?
        </p>

        <div className="adm-payment-shortfall-ledger" aria-label="תצוגת הוספה לעמלות">
          <div className="adm-payment-shortfall-ledger-row">
            <span>תשלום יתר</span>
            <strong dir="ltr" className="adm-payment-fee-amt--credit">
              {formatOverpaymentUsdSigned(surplusUsd)}
            </strong>
          </div>
          <div className="adm-payment-shortfall-ledger-row">
            <span>יתרת עמלות לפני</span>
            <strong dir="ltr">${formatUsdDisplay(commissionBalanceUsd)}</strong>
          </div>
          <div className="adm-payment-shortfall-ledger-divider" aria-hidden />
          <div className="adm-payment-shortfall-ledger-row adm-payment-shortfall-ledger-row--after">
            <span>יתרת עמלות אחרי</span>
            <strong dir="ltr" className="adm-payment-fee-amt--credit">
              ${formatUsdDisplay(commissionAfterUsd)}
            </strong>
          </div>
        </div>

        <div className="adm-mini-modal-actions">
          {onEditOrder ? (
            <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onEditOrder}>
              עריכת הזמנה
            </button>
          ) : null}
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onCancel}>
            חזרה לקליטה
          </button>
          <button type="button" className="adm-btn adm-btn--primary" disabled={busy} onClick={() => onConfirm("commission")}>
            {busy ? "שומר…" : "אישור והוספה לעמלות"}
          </button>
        </div>
      </div>
    </div>
  );
}
