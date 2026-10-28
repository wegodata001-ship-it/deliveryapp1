"use client";

import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";

export function CashflowCashboxCards({ flow }: { flow: FlowWeekPayload | null }) {
  if (!flow) return null;
  const { cashboxes, managerCountState } = flow;
  const usd = cashboxes.usd;
  const ils = cashboxes.ils;

  function renderBox(
    title: string,
    line: typeof usd,
    currency: "ILS" | "USD",
  ) {
    const receiptsBased =
      currency === "USD" ? cashboxes.receiptsBasedUsd : cashboxes.receiptsBasedIls;
    const closing = managerCountState === "NONE" ? receiptsBased : line.drawerBalance;
    return (
      <article className="cfc-cashbox-card">
        <h3 className="cfc-cashbox-card__title">{title}</h3>
        <dl className="cfc-cashbox-card__grid">
          <div>
            <dt>יתרת פתיחה</dt>
            <dd dir="ltr">
              {line.openingVerified && line.opening != null
                ? signedMoney(currency, line.opening)
                : cashboxes.openingMessageHe || "יתרת פתיחה לא מאומתת"}
            </dd>
          </div>
          <div>
            <dt>כניסות</dt>
            <dd dir="ltr">{signedMoney(currency, line.inflows)}</dd>
          </div>
          <div>
            <dt>יציאות</dt>
            <dd dir="ltr">{signedMoney(currency, -line.outflows)}</dd>
          </div>
          <div>
            <dt>יתרה מחושבת</dt>
            <dd dir="ltr">{signedMoney(currency, line.closingCalculated)}</dd>
          </div>
          <div>
            <dt>נספר בפועל</dt>
            <dd dir="ltr">
              {line.countedPhysical != null
                ? signedMoney(currency, line.countedPhysical)
                : "טרם בוצעה ספירה"}
            </dd>
          </div>
          <div>
            <dt>יתרה בקופה</dt>
            <dd dir="ltr" className={managerCountState === "NONE" ? "cfc-muted" : ""}>
              {managerCountState === "NONE"
                ? closing != null
                  ? `מחושב מתקבולים: ${signedMoney(currency, closing)}`
                  : "—"
                : closing != null
                  ? signedMoney(currency, closing)
                  : "—"}
            </dd>
          </div>
        </dl>
      </article>
    );
  }

  return (
    <section className="cfc-cashbox-cards" aria-label="קופות">
      {renderBox("קופת דולר", usd, "USD")}
      {renderBox("קופת שקל", ils, "ILS")}
    </section>
  );
}
