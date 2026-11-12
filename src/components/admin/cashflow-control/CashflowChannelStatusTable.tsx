"use client";

import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import type { CashDailyMethodId } from "@/lib/cash-control-daily";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { flowCountStatusLabel } from "@/lib/flow-control/flow-control-status";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";

function routeOf(method: CashDailyMethodId): "PS" | "IL" | "—" {
  if (method.startsWith("CASH_")) return "PS";
  if (method.startsWith("BANK_") || method.startsWith("CREDIT_") || method.startsWith("CHECK_")) return "IL";
  return "—";
}

export function CashflowChannelStatusTable({ drill }: { drill: FlowWeekDrillPayload }) {
  const lines = getFlowWeekVarianceLines(drill).filter(
    (line) =>
      Math.abs(line.expectedAmount) > 0.004 ||
      Math.abs(line.expensesAmount) > 0.004 ||
      line.countedAmount != null,
  );

  return (
    <section className="cfc-card cfc-channel-status" aria-label="ערוצי תשלום לפי מטבע">
      <header className="cfc-summary-table-title">
        <strong>ערוצי תשלום · התקבל, צפוי וספירה</strong>
        <span>כל שורה במטבע שלה. המתנה לספירה אינה חריגה כספית.</span>
      </header>
      {lines.length === 0 ? (
        <p className="cfc-channel-status__note">אין תנועות בערוצי השבוע.</p>
      ) : (
        <div className="cfc-table-scroll">
          <table className="cfc-table">
            <thead>
              <tr>
                <th>ערוץ</th>
                <th>מסלול</th>
                <th>מטבע</th>
                <th>התקבל</th>
                <th>הוצאות</th>
                <th>צפוי נטו</th>
                <th>נספר</th>
                <th>הפרש</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.method}>
                  <td>{line.label}</td>
                  <td>{routeOf(line.method)}</td>
                  <td>{line.currency === "ILS" ? "₪" : "$"}</td>
                  <td dir="ltr">{fmtDailyMoney(line.currency, line.expectedAmount)}</td>
                  <td dir="ltr">{fmtDailyMoney(line.currency, line.expensesAmount)}</td>
                  <td dir="ltr">{fmtDailyMoney(line.currency, line.expectedNet)}</td>
                  <td dir="ltr">
                    {line.countedAmount == null ? "—" : fmtDailyMoney(line.currency, line.countedAmount)}
                  </td>
                  <td dir="ltr">{line.variance == null ? "—" : fmtDailyMoney(line.currency, line.variance)}</td>
                  <td>{flowCountStatusLabel(line.cashControlStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
