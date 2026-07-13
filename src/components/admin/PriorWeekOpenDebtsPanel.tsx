"use client";

import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { paymentMethodBucketKey, type PaymentBucketKey } from "@/lib/payment-breakdown-shared";
import { paymentPlanStatusLabelHe } from "@/lib/payment-plan-types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtUsd(n: number): string {
  return `$${round2(n).toFixed(2)}`;
}

function remainingByBucket(order: PaymentIntakeOrderRow): Record<PaymentBucketKey, number> {
  const out: Record<PaymentBucketKey, number> = {
    CASH: 0,
    BANK_TRANSFER: 0,
    CREDIT: 0,
    CHECK: 0,
    OTHER: 0,
  };
  for (const b of order.breakdown) {
    const bucket = paymentMethodBucketKey(b.method);
    out[bucket] = round2(out[bucket] + b.remainingUsd);
  }
  return out;
}

type Props = {
  orders: PaymentIntakeOrderRow[];
  intakeWeekCode: string | null;
  onOrderClick?: (orderId: string) => void;
};

export function PriorWeekOpenDebtsPanel({ orders, intakeWeekCode, onOrderClick }: Props) {
  const prior = orders.filter((o) => o.isPriorWeekOpenDebt && Number(o.dbRemainingUsd) > 0.02);
  if (prior.length === 0) return null;

  return (
    <section className="payment-prior-debts" dir="rtl" aria-label="חובות פתוחים משבועות קודמים">
      <header className="payment-prior-debts__head">
        <h3 className="payment-prior-debts__title">חובות פתוחים משבועות קודמים</h3>
        <p className="payment-prior-debts__sub">
          חלוקת התשלום נשמרת וממשיכה לשבוע {intakeWeekCode ?? "—"} — אין שכפול במעבר שבוע.
        </p>
      </header>
      <div className="payment-prior-debts__scroll">
        <table className="payment-prior-debts__table">
          <thead>
            <tr>
              <th>הזמנה</th>
              <th>שבוע מקור</th>
              <th>תאריך</th>
              <th className="pm-num">חוב פתוח</th>
              <th className="pm-num">מזומן נותר</th>
              <th className="pm-num">העברה נותרה</th>
              <th className="pm-num">אשראי נותר</th>
              <th className="pm-num">צ׳קים נותרו</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {prior.map((o) => {
              const buckets = remainingByBucket(o);
              const planStatus = o.paymentPlan?.status ?? "ACTIVE";
              const planWeek = o.paymentPlan?.createdInWeekCode ?? o.week ?? "—";
              return (
                <tr
                  key={o.id}
                  className="payment-prior-debts__row"
                  onClick={() => onOrderClick?.(o.id)}
                  title={`חלוקה מ-${planWeek} · עדכון אחרון ${o.paymentPlan?.updatedAtYmd ?? "—"}`}
                >
                  <td dir="ltr" className="pm-mono">
                    <span className="payment-prior-debts__badge">חוב משבוע קודם</span>
                    {o.orderNumber ?? "—"}
                  </td>
                  <td dir="ltr">{o.week ?? "—"}</td>
                  <td dir="ltr">{o.dateYmd}</td>
                  <td dir="ltr" className="pm-num">
                    {fmtUsd(Number(o.dbRemainingUsd))}
                  </td>
                  <td dir="ltr" className="pm-num">
                    {fmtUsd(buckets.CASH)}
                  </td>
                  <td dir="ltr" className="pm-num">
                    {fmtUsd(buckets.BANK_TRANSFER)}
                  </td>
                  <td dir="ltr" className="pm-num">
                    {fmtUsd(buckets.CREDIT)}
                  </td>
                  <td dir="ltr" className="pm-num">
                    {fmtUsd(buckets.CHECK)}
                  </td>
                  <td>
                    <span className="payment-prior-debts__status">{paymentPlanStatusLabelHe(planStatus)}</span>
                    <span className="payment-prior-debts__meta" dir="ltr">
                      חלוקה: {planWeek}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
