"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { buildFlowCalculationTableRow } from "@/lib/flow-control/services/cashflow-calculation-table.service";
import { fcNum } from "@/components/admin/flow-control/shared";
import { varianceStatusLabel } from "@/lib/cash-control-variance";

export type CashflowCalculationTableProps = {
  drill: FlowWeekDrillPayload | null;
  loading?: boolean;
  onVarianceClick?: () => void;
  onFxProfitClick?: () => void;
};

function StatusBadge({ status }: { status: "ok" | "warn" | "critical" | "pending" }) {
  if (status === "ok") {
    return (
      <span className="ft-status ft-status--ok">
        <CheckCircle2 size={14} /> תקין
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="ft-status ft-status--pending">
        <Clock size={14} /> ממתין
      </span>
    );
  }
  return (
    <span className="ft-status ft-status--bad">
      <AlertTriangle size={14} /> {status === "critical" ? "חריג" : "הפרש"}
    </span>
  );
}

function fmtDiff(currency: "ILS" | "USD", raw: string | null): string {
  if (raw == null) return "—";
  const n = fcNum(raw);
  if (Math.abs(n) < 0.01) return fmtDailyMoney(currency, 0);
  const body = fmtDailyMoney(currency, Math.abs(n));
  return n < 0 ? `${body}-` : body;
}

export function CashflowCalculationTable({
  drill,
  loading,
  onVarianceClick,
  onFxProfitClick,
}: CashflowCalculationTableProps) {
  const row = useMemo(() => (drill ? buildFlowCalculationTableRow(drill) : null), [drill]);

  if (loading) return <p className="ft-empty">טוען חישובים…</p>;
  if (!drill || !row) return null;

  const fxNet = fcNum(row.fxNetIls);
  const hasVariance = row.status === "warn" || row.status === "critical";
  const statusClickable = !!onVarianceClick;

  return (
    <div className="ft-table-wrap ft-table-wrap--wide">
      <table className="ft-table ft-table--calc">
        <thead>
          <tr>
            <th title="יתרת דולר בקופה לאחר כל הפעולות">דולר בקופה</th>
            <th title="יתרת שקל בקופה לאחר כל הפעולות">שקל בקופה</th>
            <th title="יתרה להעברה לטורקיה">יתרה לטורקיה</th>
            <th title="יתרה בבנק">יתרה בבנק</th>
            <th>הוצאות קופה ₪</th>
            <th>הוצאות קופה $</th>
            <th title="התקבל פחות הוצאות — דולר">צפוי נטו $</th>
            <th title="התקבל פחות הוצאות — שקל">צפוי נטו ₪</th>
            <th>ספירה בפועל $</th>
            <th>ספירה בפועל ₪</th>
            <th title="נספר − צפוי נטו">הפרש $</th>
            <th title="נספר − צפוי נטו">הפרש ₪</th>
            <th>רווח/הפסד מט&quot;ח</th>
            <th>סטטוס</th>
            <th>הערות חריגה</th>
          </tr>
        </thead>
        <tbody>
          <tr className="ft-row">
            <td dir="ltr" className="ft-cell--computed">
              {fmtDailyMoney("USD", fcNum(row.drawerUsd))}
            </td>
            <td dir="ltr" className="ft-cell--computed">
              {fmtDailyMoney("ILS", fcNum(row.drawerIls))}
            </td>
            <td dir="ltr" className="ft-cell--computed">
              {fcNum(row.turkeyBalanceUsd) > 0
                ? fmtDailyMoney("USD", fcNum(row.turkeyBalanceUsd))
                : "—"}
            </td>
            <td dir="ltr" className="ft-cell--computed">
              {fmtDailyMoney("ILS", fcNum(row.bankBalanceIls))}
            </td>
            <td dir="ltr">{fmtDailyMoney("ILS", fcNum(row.expensesIls))}</td>
            <td dir="ltr">{fmtDailyMoney("USD", fcNum(row.expensesUsd))}</td>
            <td dir="ltr" className="ft-cell--computed">
              {fmtDailyMoney("USD", fcNum(row.expectedNetUsd))}
            </td>
            <td dir="ltr" className="ft-cell--computed">
              {fmtDailyMoney("ILS", fcNum(row.expectedNetIls))}
            </td>
            <td dir="ltr">{row.countedUsd ? fmtDailyMoney("USD", fcNum(row.countedUsd)) : "לא הוזן"}</td>
            <td dir="ltr">{row.countedIls ? fmtDailyMoney("ILS", fcNum(row.countedIls)) : "לא הוזן"}</td>
            <td dir="ltr" className={hasVariance ? "ft-diff--bad" : ""}>
              {hasVariance && onVarianceClick ? (
                <button type="button" className="ft-amount-link" onClick={onVarianceClick}>
                  {fmtDiff("USD", row.diffUsd)}
                </button>
              ) : (
                fmtDiff("USD", row.diffUsd)
              )}
            </td>
            <td dir="ltr" className={hasVariance ? "ft-diff--bad" : ""}>
              {hasVariance && onVarianceClick ? (
                <button type="button" className="ft-amount-link" onClick={onVarianceClick}>
                  {fmtDiff("ILS", row.diffIls)}
                </button>
              ) : (
                fmtDiff("ILS", row.diffIls)
              )}
            </td>
            <td dir="ltr">
              {fxNet !== 0 || fcNum(row.fxProfitIls) > 0 ? (
                <button type="button" className="ft-amount-link" onClick={onFxProfitClick}>
                  {fxNet >= 0
                    ? `${fmtDailyMoney("ILS", fxNet)} רווח`
                    : `${fmtDailyMoney("ILS", Math.abs(fxNet))} הפסד`}
                </button>
              ) : (
                "—"
              )}
            </td>
            <td>
              {statusClickable ? (
                <button type="button" className="ft-status-btn" onClick={onVarianceClick}>
                  <StatusBadge status={row.status} />
                </button>
              ) : (
                <StatusBadge status={row.status} />
              )}
            </td>
            <td className="ft-notes">
              {statusClickable ? (
                <button type="button" className="ft-amount-link" onClick={onVarianceClick}>
                  {hasVariance
                    ? `${varianceStatusLabel(row.status)} — לחץ לפירוט`
                    : `${varianceStatusLabel(row.status)} — לחץ לפירוט הסטטוס`}
                </button>
              ) : (
                "—"
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default CashflowCalculationTable;
