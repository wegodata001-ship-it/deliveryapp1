"use client";

import { formatCommissionPercentValue } from "@/lib/commission-percent";
import type { PaymentAllocationPreviewResult } from "@/lib/payment-allocation-preview";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  preview: PaymentAllocationPreviewResult;
};

function money(usd: number): string {
  return `$${formatUsdDisplay(usd)}`;
}

export function PaymentAllocationPreviewPanel({ preview }: Props) {
  if (!preview.show) return null;

  return (
    <section
      className="payment-alloc-preview"
      dir="rtl"
      aria-live="polite"
      aria-label="פירוט הקצאה"
    >
      <h4 className="payment-alloc-preview__heading">Preview Allocation</h4>
      <p className="payment-alloc-preview__subtitle">תצוגת הקצאה לפני שמירה — ללא עדכון במסד</p>

      {!preview.hasAllocations ? (
        <p className="payment-alloc-preview__empty">
          אין חובות פתוחים להקצאה — הסכום לא יסוגר להזמנות (יתרת זכות / לא מוקצה).
        </p>
      ) : (
        <ul className="payment-alloc-preview__orders">
          {preview.orders.map((row) => (
            <li key={row.orderId} className="payment-alloc-preview__order">
              <div className="payment-alloc-preview__order-num" dir="ltr">
                {row.orderNumber}
              </div>
              <div className="payment-alloc-preview__alloc-lines">
                <div className="payment-alloc-preview__line">
                  <span className="payment-alloc-preview__k">לפני:</span>
                  <span className="payment-alloc-preview__v" dir="ltr">
                    {money(row.beforeUsd)}
                  </span>
                </div>
                <div className="payment-alloc-preview__line payment-alloc-preview__line--alloc">
                  <span className="payment-alloc-preview__k">מוקצה:</span>
                  <span className="payment-alloc-preview__v" dir="ltr">
                    {money(row.allocatedUsd)}
                  </span>
                </div>
                <div className="payment-alloc-preview__line">
                  <span className="payment-alloc-preview__k">אחרי:</span>
                  <span className="payment-alloc-preview__v" dir="ltr">
                    {money(row.afterUsd)}
                  </span>
                </div>
              </div>
              <div className="payment-alloc-preview__commission" aria-label="פירוט חישוב עמלה">
                <div className="payment-alloc-preview__commission-title">פירוט חישוב עמלה</div>
                <dl className="payment-alloc-preview__commission-grid">
                  <div className="payment-alloc-preview__commission-row">
                    <dt>סכום מקור</dt>
                    <dd dir="ltr">{money(row.sourceUsd)}</dd>
                  </div>
                  <div className="payment-alloc-preview__commission-row">
                    <dt>אחוז עמלה</dt>
                    <dd dir="ltr">{formatCommissionPercentValue(row.commissionPercent)}%</dd>
                  </div>
                  <div className="payment-alloc-preview__commission-row">
                    <dt>סכום עמלה</dt>
                    <dd dir="ltr">{money(row.commissionUsd)}</dd>
                  </div>
                  <div className="payment-alloc-preview__commission-row">
                    <dt>סכום לאחר עמלה</dt>
                    <dd dir="ltr">{money(row.afterCommissionUsd)}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview.hasAllocations ? (
        <div className="payment-alloc-preview__footer">
          <div className="payment-alloc-preview__total">
            <span>סה״כ מוקצה:</span>
            <strong dir="ltr">{money(preview.totalAllocatedUsd)}</strong>
          </div>
          {preview.unallocatedUsd > 0.02 ? (
            <div className="payment-alloc-preview__unallocated">
              <span>לא מוקצה להזמנות:</span>
              <strong dir="ltr">{money(preview.unallocatedUsd)}</strong>
            </div>
          ) : null}
        </div>
      ) : preview.paymentTotalUsd > 0.02 ? (
        <div className="payment-alloc-preview__footer">
          <div className="payment-alloc-preview__unallocated">
            <span>סכום תשלום שלא הוקצה:</span>
            <strong dir="ltr">{money(preview.paymentTotalUsd)}</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
