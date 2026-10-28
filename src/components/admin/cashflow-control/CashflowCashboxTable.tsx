"use client";

import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";
import { signedMoney } from "@/components/admin/cashflow-control/cashflow-control-helpers";
import {
  cashboxTableStatus,
  fmtOpening,
} from "@/components/admin/cashflow-control/cashflow-cashbox-display";

export function CashflowCashboxTable({ flow }: { flow: FlowWeekPayload | null }) {
  if (!flow) {
    return <p className="cfc-empty cfc-empty--inline">אין נתוני קופה לשבוע</p>;
  }

  const { cashboxes, managerCountState } = flow;

  function row(currency: "USD" | "ILS", title: string) {
    const line = currency === "USD" ? cashboxes.usd : cashboxes.ils;
    const diff =
      line.countVariance != null && line.countedPhysical != null
        ? signedMoney(currency, line.countVariance)
        : "—";
    return (
      <tr key={currency}>
        <td>
          <strong>{title}</strong>
          <span className="cfc-muted"> ({currency === "USD" ? "$" : "₪"})</span>
        </td>
        <td dir="ltr">{fmtOpening(line, currency, cashboxes.openingMessageHe)}</td>
        <td dir="ltr">{signedMoney(currency, line.inflows)}</td>
        <td dir="ltr">{signedMoney(currency, -line.outflows)}</td>
        <td dir="ltr">{signedMoney(currency, line.closingCalculated)}</td>
        <td dir="ltr">
          {line.countedPhysical != null
            ? signedMoney(currency, line.countedPhysical)
            : "טרם בוצעה ספירה"}
        </td>
        <td dir="ltr">{diff}</td>
        <td>
          <span className={`cfc-count-badge cfc-count-badge--${managerCountState.toLowerCase()}`}>
            {cashboxTableStatus(line, managerCountState)}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div className="cfc-table-scroll cfc-table-scroll--tight">
      <table className="cfc-table cfc-compact-table">
        <thead>
          <tr>
            <th>מטבע</th>
            <th>יתרת פתיחה</th>
            <th>כניסות</th>
            <th>יציאות</th>
            <th>יתרה מחושבת</th>
            <th>נספר בפועל</th>
            <th>הפרש</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {row("USD", "דולר")}
          {row("ILS", "שקל")}
        </tbody>
      </table>
    </div>
  );
}
