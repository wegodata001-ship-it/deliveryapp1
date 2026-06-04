"use client";

import type { LedgerPaymentDetail } from "@/lib/ledger-payment-detail";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";

function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

type Props = {
  detail: LedgerPaymentDetail;
};

export function LedgerPaymentDetailBlock({ detail }: Props) {
  return (
    <div className="adm-ledger-payment-detail" dir="rtl">
      <div className="adm-ledger-payment-detail-head">
        <span className="adm-ledger-payment-detail-code" dir="ltr">
          {detail.paymentCode}
        </span>
        <span className="adm-ledger-payment-detail-total" dir="ltr">
          סה״כ: {fmtUsd(detail.totalUsd)}
        </span>
      </div>

      <section className="adm-ledger-payment-detail-section">
        <h4 className="adm-ledger-payment-detail-section-title">פירוט אמצעי תשלום</h4>
        {detail.methods.length > 0 ? (
          <ul className="adm-ledger-payment-detail-list">
            {detail.methods.map((m) => (
              <li key={m.method}>
                <span>{m.label}</span>
                <span dir="ltr">{fmtUsd(m.amountUsd)}</span>
              </li>
            ))}
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
                {o.orderNumber} → {fmtUsd(o.amountUsd)}
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
