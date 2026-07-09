"use client";

import { Lock } from "lucide-react";
import { fmtDailyMoney, type CashDailyMethodId } from "@/lib/cash-control-daily";
import type { CashDailyDayDetailPayload } from "@/app/admin/cash-control/daily-types";
import { MethodIcon, num } from "@/components/admin/cash-flow/shared";

type ReconLine = CashDailyDayDetailPayload["reconciliation"][number];

export type PaymentIntakeSectionProps = {
  reconciliation: ReconLine[];
  methodDrill: CashDailyMethodId | null;
  onDrill: (method: CashDailyMethodId) => void;
};

/** אזור 2 — כספים שהתקבלו אוטומטית מקליטות התשלום (כחול, קריאה בלבד) */
export function PaymentIntakeSection({ reconciliation, methodDrill, onDrill }: PaymentIntakeSectionProps) {
  return (
    <section className="cc-block cc-block--auto cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--blue" aria-hidden />
          קליטות תשלום
        </div>
        <span className="cc-block__note cc-block__note--lock">
          <Lock size={12} aria-hidden /> מתעדכן אוטומטית מקליטות התשלום
        </span>
      </header>
      <div className="cc-metric-grid">
        {reconciliation.map((r) => {
          const val = num(r.grossReceived);
          const clickable = val > 0;
          const active = methodDrill === r.method;
          return (
            <button
              key={r.method}
              type="button"
              className={`cc-metric${clickable ? " is-clickable" : ""}${active ? " is-active" : ""}`}
              onClick={() => clickable && onDrill(r.method)}
              disabled={!clickable}
            >
              <span className="cc-metric__label">
                <MethodIcon method={r.method} size={14} />
                {r.label}
              </span>
              <span className="cc-metric__value" dir="ltr">
                {clickable ? fmtDailyMoney(r.currency, val) : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default PaymentIntakeSection;
