"use client";

import { AlertTriangle, CheckCircle2, Plane } from "lucide-react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  TURKEY_WEEK_STATUS_LABELS,
  type TurkeyWeekStatus,
} from "@/lib/flow-control/turkey-transfer-balance-types";

export function TurkeyDebtCard({
  openingUsd,
  addedUsd,
  transferredUsd,
  closingUsd,
  status,
  expectedUsd,
  actualUsd,
  debtUsd,
}: {
  openingUsd?: string;
  addedUsd?: string;
  transferredUsd?: string;
  closingUsd: string;
  status: TurkeyWeekStatus | "ok" | "debt";
  /** תאימות לאחור */
  expectedUsd?: string;
  actualUsd?: string | null;
  debtUsd?: string;
}) {
  const closing = fcNum(closingUsd || debtUsd);
  const isAwaiting = closing > 0.005;
  const statusKey: TurkeyWeekStatus =
    status === "ok" || status === "debt"
      ? isAwaiting
        ? "AWAITING_TRANSFER"
        : "FULLY_TRANSFERRED"
      : status;

  return (
    <article className={`fc-card fc-card--turkey is-${isAwaiting ? "debt" : "ok"}`}>
      <header>
        <Plane size={20} />
        <h3>יתרה להעברה לטורקיה</h3>
        {!isAwaiting ? (
          <CheckCircle2 size={18} className="fc-status-ok" />
        ) : (
          <AlertTriangle size={18} className="fc-status-await" />
        )}
      </header>
      <div className="fc-card__rows">
        {openingUsd != null ? (
          <div>
            <span>יתרת פתיחה</span>
            <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(openingUsd))}</strong>
          </div>
        ) : null}
        {addedUsd != null ? (
          <div>
            <span>נוסף מספירת קופה</span>
            <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(addedUsd))}</strong>
          </div>
        ) : expectedUsd != null ? (
          <div>
            <span>מוקצה מספירה (שבוע)</span>
            <strong dir="ltr">{fmtWeekFlowAmount("USD", fcNum(expectedUsd))}</strong>
          </div>
        ) : null}
        <div>
          <span>הועבר בפועל</span>
          <strong dir="ltr">
            {fmtWeekFlowAmount("USD", fcNum(transferredUsd ?? actualUsd))}
          </strong>
        </div>
        <div className={isAwaiting ? "fc-debt-line" : ""}>
          <span>יתרת סגירה</span>
          <strong dir="ltr">{fmtWeekFlowAmount("USD", closing)}</strong>
        </div>
        <div className="fc-card__status-line">
          <span>סטטוס</span>
          <strong>{TURKEY_WEEK_STATUS_LABELS[statusKey] ?? statusKey}</strong>
        </div>
      </div>
    </article>
  );
}

export default TurkeyDebtCard;
