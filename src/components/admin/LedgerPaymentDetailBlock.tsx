"use client";

import {
  ledgerPaymentExpandLines,
  ledgerPaymentMethodDisplayLines,
  type LedgerPaymentDetail,
} from "@/lib/ledger-payment-detail";
import { formatLedgerPaymentComponentDisplay, formatLedgerPaymentTotalUsd } from "@/lib/ledger-payment-display";
import { paymentMethodStyle } from "@/lib/payment-method-style";

type Props = {
  detail: LedgerPaymentDetail;
};

export function LedgerPaymentDetailBlock({ detail }: Props) {
  const expandLines = ledgerPaymentExpandLines(detail);
  const methodLines = ledgerPaymentMethodDisplayLines(detail);
  const showMethodSection =
    methodLines.length > 0 &&
    (methodLines.length > 1 || expandLines.every((l) => !methodLines.some((m) => m.label === l.label)));
  return (
    <div className="adm-ledger-payment-detail" dir="rtl">
      <div className="adm-ledger-payment-detail-head">
        <span className="adm-ledger-payment-detail-code" dir="ltr">
          {detail.paymentCode}
        </span>
        <span className="adm-ledger-payment-detail-total" dir="ltr">
          סה״כ: {formatLedgerPaymentTotalUsd(detail.totalUsd)}
        </span>
      </div>

      {expandLines.length > 0 ? (
        <section className="adm-ledger-payment-detail-section">
          <h4 className="adm-ledger-payment-detail-section-title">פירוט תשלום</h4>
          <ul className="adm-ledger-payment-detail-list">
            {expandLines.map((line, idx) => (
              <li key={`${line.label}-${idx}`}>
                <span>{line.label}:</span>
                <span dir="ltr">{line.display}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showMethodSection ? (
        <section className="adm-ledger-payment-detail-section">
          <h4 className="adm-ledger-payment-detail-section-title">פירוט אמצעי תשלום</h4>
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
                  <span dir="ltr">
                    {m.amountIls != null && Number(m.amountIls) > 0
                      ? formatLedgerPaymentComponentDisplay("ILS", m.amountIls)
                      : formatLedgerPaymentComponentDisplay("USD", m.amountUsd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : methodLines.length === 0 ? (
        <section className="adm-ledger-payment-detail-section">
          <h4 className="adm-ledger-payment-detail-section-title">פירוט אמצעי תשלום</h4>
          <p className="adm-ledger-payment-detail-empty">אין פירוט אמצעי תשלום שמור</p>
        </section>
      ) : null}

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
