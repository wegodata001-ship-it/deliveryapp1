"use client";

import { formatSignedUsdDisplay } from "@/lib/payment-adjustment-fee";
import type { PaymentFeeDetail } from "@/lib/payment-fees-source-table";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  open: boolean;
  detail: PaymentFeeDetail | null;
  busy?: boolean;
  onClose: () => void;
  onOpenOrder?: (orderId: string) => void;
  onOpenPayment?: (paymentId: string) => void;
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${formatUsdDisplay(value)}`;
}

export function PaymentFeeDetailModal({
  open,
  detail,
  busy,
  onClose,
  onOpenOrder,
  onOpenPayment,
}: Props) {
  if (!open || !detail) return null;

  const isSurplus = detail.sourceKind === "PAYMENT_SURPLUS";
  const isShortfall = detail.userChoice === "fee_adjustment_negative";

  return (
    <div className="adm-mini-modal-layer" role="presentation" onClick={onClose}>
      <div
        className="adm-mini-modal adm-payment-fee-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-fee-detail-title"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="payment-fee-detail-title" className="adm-mini-modal-title">
          פרטי עמלה
        </h2>

        <dl className="adm-payment-fee-detail-grid">
          <div>
            <dt>לקוח</dt>
            <dd>{detail.customerName}</dd>
          </div>
          <div>
            <dt>הזמנה</dt>
            <dd>
              {detail.orderId && onOpenOrder ? (
                <button type="button" className="adm-source-primary-link" onClick={() => onOpenOrder(detail.orderId!)}>
                  #{detail.orderNumber}
                </button>
              ) : (
                detail.orderNumber
              )}
            </dd>
          </div>
          <div>
            <dt>תשלום</dt>
            <dd>
              {detail.paymentId && onOpenPayment ? (
                <button
                  type="button"
                  className="adm-source-primary-link"
                  onClick={() => onOpenPayment(detail.paymentId!)}
                >
                  {detail.paymentCode}
                </button>
              ) : (
                detail.paymentCode
              )}
            </dd>
          </div>
          <div>
            <dt>מקור</dt>
            <dd>
              <span className={`adm-payment-fee-badge adm-payment-fee-badge--${detail.sourceKind.toLowerCase()}`}>
                {detail.sourceLabel}
              </span>
            </dd>
          </div>
          <div>
            <dt>סיבה</dt>
            <dd>{detail.reasonLabel}</dd>
          </div>
          <div>
            <dt>סוג</dt>
            <dd>
              <span
                className={`adm-payment-fee-badge adm-payment-fee-badge--${detail.amountKind === "DEBIT" ? "debit" : "credit"}`}
              >
                {detail.typeLabel}
              </span>
            </dd>
          </div>
          <div>
            <dt>נוצר ע&quot;י</dt>
            <dd>{detail.createdByName}</dd>
          </div>
          <div>
            <dt>תאריך</dt>
            <dd>{detail.createdAtYmd}</dd>
          </div>
        </dl>

        <div className="adm-payment-fee-detail-flow">
          {isSurplus ? (
            <>
              <p>
                <span>חוב לפני הפעולה:</span> <strong dir="ltr">{money(detail.debtBeforeUsd)}</strong>
              </p>
              <p>
                <span>תשלום שנקלט:</span> <strong dir="ltr">{money(detail.paymentCapturedUsd)}</strong>
              </p>
              <p>
                <span>עמלה שנוצרה:</span>{" "}
                <strong dir="ltr" className="adm-payment-fee-amt--credit">
                  {formatSignedUsdDisplay(detail.feeCreatedUsd)}
                </strong>
              </p>
            </>
          ) : isShortfall ? (
            <>
              <p>
                <span>חוב לפני הפעולה:</span> <strong dir="ltr">{money(detail.debtBeforeUsd)}</strong>
              </p>
              <p>
                <span>תשלום שנקלט:</span> <strong dir="ltr">{money(detail.paymentCapturedUsd)}</strong>
              </p>
              <p>
                <span>יתרה שאופסה:</span> <strong dir="ltr">{money(detail.resetUsd)}</strong>
              </p>
              <p>
                <span>עמלה שנוצרה:</span>{" "}
                <strong dir="ltr" className="adm-payment-fee-amt--debit">
                  {formatSignedUsdDisplay(detail.feeCreatedUsd)}
                </strong>
              </p>
            </>
          ) : (
            <p>
              <span>עמלה:</span>{" "}
              <strong
                dir="ltr"
                className={
                  detail.amountKind === "DEBIT" ? "adm-payment-fee-amt--debit" : "adm-payment-fee-amt--credit"
                }
              >
                {detail.amountDisplay}
              </strong>
            </p>
          )}
        </div>

        {detail.notes ? <pre className="adm-payment-fee-detail-notes">{detail.notes}</pre> : null}

        <div className="adm-mini-modal-actions">
          <button type="button" className="adm-btn adm-btn--ghost" disabled={busy} onClick={onClose}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
