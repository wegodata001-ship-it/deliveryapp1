"use client";

/**
 * כרטיס «יתרה» — מצב סופי חתום: +זכות / 0 מאוזן / −חוב.
 */
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  formatIntakeFinalBalanceUsdLine,
  formatIntakeSurplusPendingLine,
} from "@/lib/payment-intake-preview";
import {
  formatPaymentBalanceIlsLine,
  type PaymentBalanceDisplay,
} from "@/lib/order-remaining-debt";

type Props = {
  display: PaymentBalanceDisplay;
};

export function RemainingToPayCard({ display }: Props) {
  const { state, statusHint } = display;
  const surplusPendingUsd = display.surplusPendingUsd ?? 0;
  const surplusPendingLine = formatIntakeSurplusPendingLine(surplusPendingUsd);
  const usdLine = formatIntakeFinalBalanceUsdLine(display.balanceUsdSigned);
  const ilsRaw = formatPaymentBalanceIlsLine({
    ...display,
    state: state === "debt" ? "debt" : state === "credit" ? "credit" : "cleared",
  });
  const ilsLine = state === "debt" && !ilsRaw.startsWith("-") ? `-${ilsRaw}` : ilsRaw;

  return (
    <div
      className={[
        "payment-modal-live-kpi",
        "payment-remaining-to-pay",
        state === "debt"
          ? "payment-remaining-to-pay--due"
          : state === "surplus" || state === "credit"
            ? "payment-remaining-to-pay--ok payment-remaining-to-pay--surplus"
            : "payment-remaining-to-pay--ok",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={statusHint ? `יתרה — ${statusHint}` : "יתרה"}
    >
      <div className="payment-modal-live-kpi__lbl">יתרה</div>
      <AnimatedMoneyValue
        className={[
          "payment-modal-live-kpi__hero-v",
          state === "debt"
            ? "payment-modal-live-kpi__hero-v--due"
            : "payment-modal-live-kpi__hero-v--ok",
        ].join(" ")}
        dir="ltr"
        value={usdLine}
      />
      <div className="payment-modal-live-kpi__sub" dir="ltr">
        <AnimatedMoneyValue
          className="payment-modal-live-kpi__sub-ils"
          dir="ltr"
          value={ilsLine}
        />
        {statusHint ? (
          <span className="payment-modal-live-kpi__status-hint">{statusHint}</span>
        ) : null}
        {surplusPendingLine ? (
          <span className="payment-modal-live-kpi__surplus-pending" dir="rtl">
            {surplusPendingLine}
          </span>
        ) : null}
      </div>
    </div>
  );
}
