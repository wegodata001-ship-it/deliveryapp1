"use client";

import { Banknote } from "lucide-react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

export function CashBalanceCard({
  ils,
  usd,
}: {
  ils: string;
  usd: string;
}) {
  return (
    <article className="fc-card fc-card--cash">
      <header>
        <Banknote size={20} />
        <h3>יתרה בקופה</h3>
      </header>
      <div className="fc-card__values">
        <div>
          <span>שקל</span>
          <strong dir="ltr">{fmtWeekFlowAmount("ILS", fcNum(ils))}</strong>
        </div>
        <div>
          <span>דולר</span>
          <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(usd))}</strong>
        </div>
      </div>
    </article>
  );
}

export default CashBalanceCard;
