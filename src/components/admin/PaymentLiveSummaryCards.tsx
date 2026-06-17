"use client";

import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  LIVE_PAYMENT_KPI_CARDS,
  liveKpiBucket,
  type LivePaymentFormKpis,
} from "@/lib/payment-intake-live-kpi";
import { formatIlsDisplay, formatUsdDisplay, formatUsdPlain } from "@/lib/money-format";

type Props = {
  kpis: LivePaymentFormKpis;
  /** סה״כ יתרות פתוחות על הזמנות (DB) */
  openDebtUsd?: number;
  onOpenDebtClick?: () => void;
};

function totalEnteredIls(kpis: LivePaymentFormKpis): number {
  return (
    kpis.cash.enteredIls +
    kpis.bankTransfer.enteredIls +
    kpis.credit.enteredIls +
    kpis.checks.enteredIls +
    kpis.other.enteredIls
  );
}

function KpiDualAmounts({ ils, usd }: { ils: number; usd: number }) {
  return (
    <div className="payment-modal-live-kpi__amounts">
      <div className="payment-modal-live-kpi__amount-block">
        <span className="payment-modal-live-kpi__amount-k">סה&quot;כ:</span>
        <AnimatedMoneyValue
          className="payment-modal-live-kpi__amount-v payment-modal-live-kpi__amount-v--ils"
          dir="ltr"
          value={formatIlsDisplay(ils)}
        />
      </div>
      <div className="payment-modal-live-kpi__amount-block">
        <span className="payment-modal-live-kpi__amount-k">המרה לדולר:</span>
        <AnimatedMoneyValue
          className="payment-modal-live-kpi__amount-v payment-modal-live-kpi__amount-v--usd"
          dir="ltr"
          value={formatUsdDisplay(usd)}
        />
      </div>
    </div>
  );
}

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
        const bucket = liveKpiBucket(kpis, card.id);
        const enteredIls = bucket?.enteredIls ?? 0;
        const enteredUsd = bucket?.enteredUsd ?? 0;
        return (
          <div
            key={card.id}
            className={["payment-modal-live-kpi", `payment-modal-live-kpi--${card.id}`].join(" ")}
          >
            <div className="payment-modal-live-kpi__lbl">{card.label}</div>
            <KpiDualAmounts ils={enteredIls} usd={enteredUsd} />
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
            className="payment-modal-live-kpi__amount-v payment-modal-live-kpi__amount-v--usd payment-modal-live-kpi__amount-v--solo"
            dir="ltr"
            value={formatUsdPlain(openDebtUsd)}
          />
          <span className="payment-modal-live-kpi__hint">לחץ לפירוט</span>
        </button>
      ) : null}

      {totalCard ? (
        <div className="payment-modal-live-kpi payment-modal-live-kpi--total">
          <div className="payment-modal-live-kpi__lbl">{totalCard.label}</div>
          <KpiDualAmounts ils={totalEnteredIls(kpis)} usd={kpis.totalPaymentUsd} />
        </div>
      ) : null}
    </div>
  );
}
