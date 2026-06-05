"use client";

import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  LIVE_PAYMENT_KPI_CARDS,
  liveKpiBucket,
  liveKpiTotalUsd,
  type LivePaymentFormKpis,
} from "@/lib/payment-intake-live-kpi";
import { formatIlsDisplay, formatUsdDisplay } from "@/lib/money-format";

type Props = {
  kpis: LivePaymentFormKpis;
  /** סה״כ יתרות פתוחות על הזמנות (DB) */
  openDebtUsd?: number;
  onOpenDebtClick?: () => void;
};

export function PaymentLiveSummaryCards({ kpis, openDebtUsd = 0, onOpenDebtClick }: Props) {
  const showOpenDebt = openDebtUsd > 0.01;
  const methodCards = LIVE_PAYMENT_KPI_CARDS.filter((c) => !c.isTotal);
  const totalCard = LIVE_PAYMENT_KPI_CARDS.find((c) => c.isTotal);

  return (
    <div
      className={[
        "payment-modal-live-kpis",
        "payment-modal-live-kpis--inline-row",
        showOpenDebt ? "payment-modal-live-kpis--with-open-debt" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="region"
      aria-label="סיכום תשלום לפי אמצעי תשלום"
      aria-live="polite"
      dir="rtl"
    >
      {methodCards.map((card) => {
        const totalUsd = liveKpiTotalUsd(kpis, card.id);
        const bucket = liveKpiBucket(kpis, card.id);
        return (
          <div
            key={card.id}
            className={["payment-modal-live-kpi", `payment-modal-live-kpi--${card.id}`].join(" ")}
          >
            <div className="payment-modal-live-kpi__lbl">{card.label}</div>
            <AnimatedMoneyValue
              className="payment-modal-live-kpi__val payment-modal-live-kpi__val--main"
              dir="ltr"
              value={formatUsdDisplay(totalUsd)}
            />
            {bucket ? (
              <div className="payment-modal-live-kpi__breakdown" dir="ltr">
                <div className="payment-modal-live-kpi__breakdown-sep" aria-hidden />
                <div className="payment-modal-live-kpi__breakdown-line">
                  {formatUsdDisplay(bucket.enteredUsd)}
                </div>
                <div className="payment-modal-live-kpi__breakdown-line payment-modal-live-kpi__breakdown-line--ils">
                  {formatIlsDisplay(bucket.enteredIls)}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {showOpenDebt ? (
        <button
          type="button"
          className="payment-modal-live-kpi payment-modal-live-kpi--open-debt"
          onClick={onOpenDebtClick}
          title="לחץ לפירוט חובות פתוחים"
        >
          <div className="payment-modal-live-kpi__lbl">חוב פתוח</div>
          <AnimatedMoneyValue
            className="payment-modal-live-kpi__val payment-modal-live-kpi__val--main payment-modal-live-kpi__val--open-debt"
            dir="ltr"
            value={formatUsdDisplay(openDebtUsd)}
          />
          <span className="payment-modal-live-kpi__hint">לחץ לפירוט</span>
        </button>
      ) : null}

      {totalCard ? (
        <div className="payment-modal-live-kpi payment-modal-live-kpi--total">
          <div className="payment-modal-live-kpi__lbl">{totalCard.label}</div>
          <AnimatedMoneyValue
            className="payment-modal-live-kpi__val payment-modal-live-kpi__val--main"
            dir="ltr"
            value={formatUsdDisplay(liveKpiTotalUsd(kpis, "total"))}
          />
        </div>
      ) : null}
    </div>
  );
}
