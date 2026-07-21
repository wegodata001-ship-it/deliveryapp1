"use client";

/**
 * כרטיס "נשאר לתשלום" — תצוגה בלבד.
 * אין חישובים, אין state, אין hooks.
 * מקבל ערך מוכן ממקור האמת של המסך (סכום עמודת יתרת חוב בטבלה).
 */
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import { formatUsdDisplay } from "@/lib/money-format";

type Props = {
  /** חוב פתוח לתצוגה — כבר מחושב במסך, ללא חישוב חוזר כאן */
  amountUsd: number;
};

export function RemainingToPayCard({ amountUsd }: Props) {
  const due = Number.isFinite(amountUsd) && amountUsd > 0.01;
  const cleared = Number.isFinite(amountUsd) && Math.abs(amountUsd) <= 0.01;

  return (
    <div
      className={[
        "payment-modal-live-kpi",
        "payment-remaining-to-pay",
        due ? "payment-remaining-to-pay--due" : "",
        cleared ? "payment-remaining-to-pay--ok" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label="נשאר לתשלום"
    >
      <div className="payment-modal-live-kpi__lbl">נשאר לתשלום</div>
      <AnimatedMoneyValue
        className={[
          "payment-modal-live-kpi__hero-v",
          due
            ? "payment-modal-live-kpi__hero-v--due"
            : "payment-modal-live-kpi__hero-v--ok",
        ].join(" ")}
        dir="ltr"
        value={formatUsdDisplay(Math.max(0, Number.isFinite(amountUsd) ? amountUsd : 0))}
      />
    </div>
  );
}
