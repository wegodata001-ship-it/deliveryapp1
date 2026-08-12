"use client";

import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { PaymentMethodColorDot } from "@/components/admin/PaymentMethodColorDot";
import { getPaymentMethodUI } from "@/lib/payment-method-ui";

type Props = {
  methods: string[];
  labels: Record<string, string>;
  values: Record<string, number>;
  currency?: "ILS" | "USD";
};

/** KPI קומפקטי לפי אמצעי תשלום — צבעים מ-payment-method-ui */
export function PaymentMethodKpiStrip({
  methods,
  labels,
  values,
  currency = "ILS",
}: Props) {
  const items = methods
    .map((method) => ({
      method,
      value: values[method] ?? 0,
      ui: getPaymentMethodUI(method, labels[method]),
    }))
    .filter((item) => item.value > 0.009);

  if (items.length === 0) return null;

  return (
    <section className="cc-pm-kpi-strip" aria-label="סיכום לפי אמצעי תשלום">
      {items.map(({ method, value, ui }) => (
        <div
          key={method}
          className={`cc-pm-kpi ${ui.cssClass}`}
          style={{
            background: ui.background,
            borderColor: ui.border,
          }}
        >
          <PaymentMethodColorDot method={method} label={ui.label} size={8} />
          <strong dir="ltr" className="cc-pm-kpi__value" style={{ color: ui.textColor }}>
            {fmtDailyMoney(currency, value)}
          </strong>
        </div>
      ))}
    </section>
  );
}
