"use client";

import {
  formatOverpaymentUsdSigned,
  type PaymentOverpaymentPreview,
} from "@/lib/payment-overpayment";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  preview: PaymentOverpaymentPreview;
  /** סכום שקלים שהוזן בטופס — לתצוגה בלבד */
  enteredIlsTotal?: number | null;
};

function fmtIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentOverpaymentWarningCard({ preview, enteredIlsTotal }: Props) {
  if (!preview.hasOverpayment) return null;

  return (
    <div
      className="payment-overpayment-warning"
      dir="rtl"
      role="alert"
      aria-live="polite"
      aria-label="התשלום גבוה מהחוב הפתוח"
    >
      <p className="payment-overpayment-warning__title">⚠️ התשלום גבוה מהחוב הפתוח</p>
      <dl className="payment-overpayment-warning__stats">
        <div>
          <dt>חוב פתוח</dt>
          <dd dir="ltr">{formatUsdDisplay(preview.openDebtUsd)}</dd>
        </div>
        <div>
          <dt>תשלום שהוזן</dt>
          <dd dir="ltr">{formatUsdDisplay(preview.incomingPaymentUsd)}</dd>
        </div>
        <div>
          <dt>סוגר חוב</dt>
          <dd dir="ltr">{formatUsdDisplay(preview.closesDebtUsd)}</dd>
        </div>
        <div className="payment-overpayment-warning__stats-row--surplus">
          <dt>תשלום יתר</dt>
          <dd dir="ltr">{formatOverpaymentUsdSigned(preview.overpaymentUsd)}</dd>
        </div>
      </dl>
      {enteredIlsTotal != null && enteredIlsTotal > 0.01 ? (
        <p className="payment-overpayment-warning__ils-note" dir="ltr">
          סכום מקורי בשקלים: {fmtIls(enteredIlsTotal)}
        </p>
      ) : null}
    </div>
  );
}
