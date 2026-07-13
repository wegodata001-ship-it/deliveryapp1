"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { DebtBreakdownAdjustmentRow } from "@/lib/customer-debt-breakdown-types";

function moneySigned(n: number): string {
  const abs = formatUsdDisplay(Math.abs(n));
  if (n < -0.01) return `-$${abs}`;
  if (n > 0.01) return `$${abs}`;
  return "$0.00";
}

export function DebtAdjustmentsTable({ rows }: { rows: DebtBreakdownAdjustmentRow[] }) {
  return (
    <div className="debt-breakdown-table-wrap">
      <table className="debt-breakdown-table">
        <thead>
          <tr>
            <th>סוג</th>
            <th>תאריך</th>
            <th>סכום</th>
            <th>פירוט</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="debt-breakdown-table__empty">
                אין יתרות או התאמות נוספות
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td dir="ltr">{r.dateYmd ?? "—"}</td>
                <td dir="ltr" className={r.amountUsd < 0 ? "is-credit" : "is-charge"}>
                  {moneySigned(r.amountUsd)}
                </td>
                <td>{r.description ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DebtAdjustmentsTable;
