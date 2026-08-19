"use client";

/**
 * כרטיס יתרת חוב / שולם במלואו / עודף — תצוגה בלבד.
 * USD גדול; ₪ שווי קטן מתחת. מקבל display מוכן מ-derivePaymentBalanceDisplay.
 */
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  formatPaymentBalanceIlsLine,
  formatPaymentBalanceUsdLine,
  type PaymentBalanceDisplay,
} from "@/lib/order-remaining-debt";

type Props = {
  display: PaymentBalanceDisplay;
};

export function RemainingToPayCard({ display }: Props) {
  const { state, title } = display;
  const usdLine = formatPaymentBalanceUsdLine(display);
  const ilsLine = formatPaymentBalanceIlsLine(display);

  return (
    <div
      className={[
        "payment-modal-live-kpi",
        "payment-remaining-to-pay",
        state === "debt" ? "payment-remaining-to-pay--due" : "",
        state === "cleared" ? "payment-remaining-to-pay--ok" : "",
        state === "surplus" ? "payment-modal-live-kpi--order-summary--surplus" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={title}
    >
      <div className="payment-modal-live-kpi__lbl">{title}</div>
      <AnimatedMoneyValue
        className={[
          "payment-modal-live-kpi__hero-v",
          state === "debt"
            ? "payment-modal-live-kpi__hero-v--due"
            : state === "cleared"
              ? "payment-modal-live-kpi__hero-v--ok"
              : "payment-modal-live-kpi__hero-v--surplus",
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
      </div>
    </div>
  );
}
