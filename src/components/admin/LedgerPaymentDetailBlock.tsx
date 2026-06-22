"use client";

import {
  ledgerPaymentMethodDisplayLines,
  type LedgerPaymentDetail,
} from "@/lib/ledger-payment-detail";
import { LedgerDualAmountDisplay } from "@/components/admin/LedgerDualAmountDisplay";
import { paymentMethodStyle } from "@/lib/payment-method-style";

type Props = {
  detail: LedgerPaymentDetail;
};

export function LedgerPaymentDetailBlock({ detail }: Props) {
  const methodLines = ledgerPaymentMethodDisplayLines(detail);
  return (
    <div className="adm-ledger-payment-detail" dir="rtl">
      <div className="adm-ledger-payment-detail-head">
        <span className="adm-ledger-payment-detail-code" dir="ltr">
          {detail.paymentCode}
        </span>
        <span className="adm-ledger-payment-detail-total" dir="ltr">
          סה״כ:{" "}
          <LedgerDualAmountDisplay amountIls={detail.totalIls} amountUsd={detail.totalUsd} />
        </span>
      </div>

      <section className="adm-ledger-payment-detail-section">
        <h4 className="adm-ledger-payment-detail-section-title">פירוט אמצעי תשלום</h4>
        {methodLines.length > 0 ? (
          <ul className="adm-ledger-payment-detail-list">
            {methodLines.map((m, idx) => {
              const style = paymentMethodStyle(m.method);
              return (
                <li key={`${m.label}-${idx}`}>
                  <span>
                    <span
                      className="adm-ledger-method-dot"
                      style={{ background: style.color }}
                      aria-hidden
                    />
                    ↳ <span style={{ color: style.color, fontWeight: 700 }}>{m.label}</span>:
                  </span>
                  <LedgerDualAmountDisplay amountIls={m.amountIls} amountUsd={m.amountUsd} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="adm-ledger-payment-detail-empty">אין פירוט אמצעי תשלום שמור</p>
        )}
      </section>

      <section className="adm-ledger-payment-detail-section">
        <h4 className="adm-ledger-payment-detail-section-title">הזמנות ששולמו ע״י התשלום</h4>
        {detail.orders.length > 0 ? (
          <ul className="adm-ledger-payment-detail-list adm-ledger-payment-detail-list--orders">
            {detail.orders.map((o) => (
              <li key={`${o.orderNumber}-${o.amountUsd}`} dir="ltr">
                {o.orderNumber} → ${o.amountUsd}
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-ledger-payment-detail-empty">לא שויך להזמנות ספציפיות</p>
        )}
      </section>
    </div>
  );
}
