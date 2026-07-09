"use client";

import { AlertTriangle, CheckCircle2, Plane } from "lucide-react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";

export function TurkeyDebtCard({
  expectedUsd,
  actualUsd,
  debtUsd,
  status,
}: {
  expectedUsd: string;
  actualUsd: string | null;
  debtUsd: string;
  status: "ok" | "debt";
}) {
  return (
    <article className={`fc-card fc-card--turkey is-${status}`}>
      <header>
        <Plane size={20} />
        <h3>חוב לטורקיה</h3>
        {status === "ok" ? (
          <CheckCircle2 size={18} className="fc-status-ok" />
        ) : (
          <AlertTriangle size={18} className="fc-status-debt" />
        )}
      </header>
      <div className="fc-card__rows">
        <div>
          <span>צריך להעביר</span>
          <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(expectedUsd))}</strong>
        </div>
        <div>
          <span>הועבר בפועל</span>
          <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(actualUsd))}</strong>
        </div>
        <div className={status === "debt" ? "fc-debt-line" : ""}>
          <span>הפרש / חוב</span>
          <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(debtUsd))}</strong>
        </div>
      </div>
    </article>
  );
}

export default TurkeyDebtCard;
