"use client";

import { Landmark } from "lucide-react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

export function BankBalanceCard({ ils }: { ils: string | null }) {
  return (
    <article className="fc-card fc-card--bank">
      <header>
        <Landmark size={20} />
        <h3>יתרה בבנק</h3>
      </header>
      <div className="fc-card__values">
        <div>
          <span>שקל</span>
          <strong dir="ltr">{fmtWeekFlowAmount("ILS", fcNum(ils))}</strong>
        </div>
        <p className="fc-card__hint">מחושב: כסף שהועבר לבנק מרכישות מט״ח</p>
      </div>
    </article>
  );
}

export default BankBalanceCard;
