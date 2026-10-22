"use client";

/**
 * כרטיס «יתרת לקוח» — CURRENT net: +זכות / 0 מאוזן / −חוב.
 */
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  formatIntakeCustomerBalanceHeroLine,
  formatIntakeSurplusPendingLine,
} from "@/lib/payment-intake-preview";
import {
  formatPaymentBalanceIlsLine,
  type PaymentBalanceDisplay,
} from "@/lib/order-remaining-debt";

type Props = {
  display: PaymentBalanceDisplay | null;
};

export function remainingToPayCardHero(display: PaymentBalanceDisplay): string {
  return formatIntakeCustomerBalanceHeroLine({
    signedBalanceUsd: display.balanceUsdSigned,
    surplusPendingUsd: display.surplusPendingUsd ?? 0,
  });
}

export function RemainingToPayCard({ display }: Props) {
  if (!display) {
    return (
      <div
        className="payment-modal-live-kpi payment-remaining-to-pay"
        role="status"
        aria-busy="true"
        aria-label="יתרת לקוח"
        data-testid="payment-customer-balance-card"
      >
        <div className="payment-modal-live-kpi__lbl">יתרת לקוח</div>
        <div className="payment-modal-live-kpi__hero-v">טוען…</div>
      </div>
    );
  }

  const { state, statusHint } = display;
  const surplusPendingUsd = display.surplusPendingUsd ?? 0;
  const surplusPendingLine = formatIntakeSurplusPendingLine(surplusPendingUsd);
  const usdLine = remainingToPayCardHero(display);
  const showHint = Boolean(statusHint);
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
            : "payment-remaining-to-pay--balanced",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={statusHint ? `יתרת לקוח — ${statusHint}` : "יתרת לקוח"}
      data-testid="payment-customer-balance-card"
      data-balance-state={state}
    >
      <div className="payment-modal-live-kpi__lbl">יתרת לקוח</div>
      <AnimatedMoneyValue
        className={[
          "payment-modal-live-kpi__hero-v",
          state === "debt"
            ? "payment-modal-live-kpi__hero-v--due"
            : state === "credit" || state === "surplus"
              ? "payment-modal-live-kpi__hero-v--ok"
              : "payment-modal-live-kpi__hero-v--neutral",
        ].join(" ")}
        dir="ltr"
        value={usdLine}
      />
      <div className="payment-modal-live-kpi__sub" dir={state === "cleared" ? "rtl" : "ltr"}>
        {state === "cleared" && surplusPendingUsd <= 0.01 ? null : (
          <AnimatedMoneyValue
            className="payment-modal-live-kpi__sub-ils"
            dir="ltr"
            value={ilsLine}
          />
        )}
        {showHint ? (
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
