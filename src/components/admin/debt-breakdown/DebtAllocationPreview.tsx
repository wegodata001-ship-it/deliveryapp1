"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { PaymentAllocationPreviewResult } from "@/lib/payment-allocation-preview";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function DebtAllocationPreview({ preview }: { preview: PaymentAllocationPreviewResult }) {
  if (!preview.show || preview.paymentTotalUsd <= 0.01) return null;

  return (
    <section className="debt-alloc-preview" dir="rtl" aria-live="polite">
      <h4 className="debt-alloc-preview__title">הקצאת תשלום (FIFO)</h4>
      <p className="debt-alloc-preview__hint">
        ההקצאה אוטומטית לפי ההזמנה הישנה ביותר — ניתן לשנות סדר עדיפות לפני שמירה.
      </p>

      {!preview.hasAllocations ? (
        <p className="debt-alloc-preview__empty">התשלום לא יוקצה להזמנות פתוחות — יישאר כיתרת זכות / לא מוקצה.</p>
      ) : (
        <ul className="debt-alloc-preview__list">
          {preview.orders
            .filter((o) => o.allocatedUsd > 0.01)
            .map((o) => (
              <li key={o.orderId}>
                <span className="debt-alloc-preview__order" dir="ltr">
                  {o.orderNumber}
                </span>
                <span className="debt-alloc-preview__amt" dir="ltr">
                  {money(o.allocatedUsd)}
                </span>
                <span className="debt-alloc-preview__status">
                  {o.afterUsd <= 0.02 ? "סגירה מלאה" : "תשלום חלקי"}
                </span>
                {o.afterUsd > 0.02 ? (
                  <span className="debt-alloc-preview__rem" dir="ltr">
                    נותר {money(o.afterUsd)}
                  </span>
                ) : null}
              </li>
            ))}
        </ul>
      )}

      {preview.unallocatedUsd > 0.02 ? (
        <p className="debt-alloc-preview__unalloc">
          לא מוקצה להזמנות: <strong dir="ltr">{money(preview.unallocatedUsd)}</strong>
        </p>
      ) : null}
    </section>
  );
}

export default DebtAllocationPreview;
