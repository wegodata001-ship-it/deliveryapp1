"use client";

import { Banknote } from "lucide-react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

export function CashBalanceCard({
  ils,
  usd,
}: {
  ils: string | null;
  usd: string | null;
}) {
  const ilsLabel =
    ils != null && ils.trim() !== "" ? fmtWeekFlowAmount("ILS", fcNum(ils)) : "טרם בוצעה ספירה";
  const usdLabel =
    usd != null && usd.trim() !== "" ? fmtWeekFlowAmount("USD", fcNum(usd)) : "טרם בוצעה ספירה";
  return (
    <article className="fc-card fc-card--cash">
      <header>
        <Banknote size={20} />
        <h3>יתרה בקופה</h3>
      </header>
      <div className="fc-card__values">
        <div>
          <span>שקל</span>
          <strong dir="ltr">{ilsLabel}</strong>
        </div>
        <div>
          <span>דולר</span>
          <strong dir="ltr">{usdLabel}</strong>
        </div>
      </div>
    </article>
  );
}

export default CashBalanceCard;
