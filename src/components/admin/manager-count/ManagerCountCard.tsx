"use client";

import { useState } from "react";
import { Calculator, ChevronLeft, Lock } from "lucide-react";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { sumFxPurchases } from "@/lib/flow-control/flow-calculation-service";
import { ManagerCountModal } from "@/components/admin/manager-count/ManagerCountModal";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ManagerCountCardProps = {
  week: string;
  weekLabel: string | null;
  flow: FlowWeekPayload | null;
  canEdit: boolean;
  onSaved: () => void;
};

export function ManagerCountCard({ week, weekLabel, flow, canEdit, onSaved }: ManagerCountCardProps) {
  const [open, setOpen] = useState(false);

  const fxTotals = flow ? sumFxPurchases(flow.fxPurchases) : { ils: 0, usd: 0 };

  return (
    <>
      <button
        type="button"
        className={`mc-entry-card${canEdit ? "" : " mc-entry-card--readonly"}`}
        onClick={() => setOpen(true)}
      >
        <div className="mc-entry-card__icon">
          <Calculator size={22} />
        </div>
        <div className="mc-entry-card__body">
          <h3>ספירת מנהל</h3>
          <p>
            {canEdit ? "לחץ להזנת ספירת קופה שבועית" : (
              <>
                <Lock size={12} aria-hidden /> צפייה בלבד
              </>
            )}
          </p>
          {flow ? (
            <div className="mc-entry-card__stats">
              <span>
                דולר PS: <strong dir="ltr">{flow.counted.CASH_USD ?? "—"}</strong>
              </span>
              <span>
                שקל PS: <strong dir="ltr">{flow.counted.CASH_ILS ?? "—"}</strong>
              </span>
              {fxTotals.usd > 0 ? (
                <span>
                  מט&quot;ח: <strong dir="ltr">{fmtDailyMoney("USD", fxTotals.usd)}</strong>
                </span>
              ) : null}
              {fcNum(flow.turkeyTransferUsd) > 0 ? (
                <span>
                  לטורקיה: <strong dir="ltr">{fmtDailyMoney("USD", fcNum(flow.turkeyTransferUsd))}</strong>
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mc-muted">אין נתונים — לחץ להזנה</p>
          )}
        </div>
        <ChevronLeft size={18} className="mc-entry-card__chev" aria-hidden />
      </button>

      <ManagerCountModal
        open={open}
        week={week}
        weekLabel={weekLabel}
        flow={flow}
        canEdit={canEdit}
        onClose={() => setOpen(false)}
        onSaved={() => {
          onSaved();
        }}
      />
    </>
  );
}

export default ManagerCountCard;
