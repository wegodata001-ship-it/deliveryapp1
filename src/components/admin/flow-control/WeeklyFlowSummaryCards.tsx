"use client";

import { Calculator } from "lucide-react";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { CashBalanceCard } from "@/components/admin/flow-control/CashBalanceCard";
import { BankBalanceCard } from "@/components/admin/flow-control/BankBalanceCard";
import { TurkeyDebtCard } from "@/components/admin/flow-control/TurkeyDebtCard";

export type WeeklyFlowSummaryCardsProps = {
  flow: FlowWeekPayload | null;
};

export function WeeklyFlowSummaryCards({ flow }: WeeklyFlowSummaryCardsProps) {
  return (
    <section className="fc-section fc-section--orange">
      <header className="fc-section__head">
        <div>
          <h2>סיכום תזרים</h2>
          <p className="fc-section__sub">
            <Calculator size={12} aria-hidden /> מחושב אוטומטית — ללא הזנה
          </p>
        </div>
      </header>
      {!flow ? (
        <p className="fc-muted">טוען סיכום…</p>
      ) : (
        <div className="fc-summary-grid">
          <CashBalanceCard ils={flow.drawerRemainingIls} usd={flow.drawerRemainingUsd} />
          <BankBalanceCard ils={flow.bankBalanceIls} />
          <TurkeyDebtCard
            expectedUsd={flow.turkeyExpectedUsd}
            actualUsd={flow.turkeyTransferUsd}
            debtUsd={flow.turkeyDebtUsd}
            status={flow.turkey.status}
          />
        </div>
      )}
    </section>
  );
}

export default WeeklyFlowSummaryCards;
