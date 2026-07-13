"use client";

import { Eye } from "lucide-react";
import { formatUsdDisplay } from "@/lib/money-format";
import type { DebtBreakdownOpenOrder } from "@/lib/customer-debt-breakdown-types";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function OpenDebtOrdersTable({
  rows,
  onOrderClick,
}: {
  rows: DebtBreakdownOpenOrder[];
  onOrderClick: (orderId: string) => void;
}) {
  return (
    <div className="debt-breakdown-table-wrap">
      <table className="debt-breakdown-table">
        <thead>
          <tr>
            <th>מספר הזמנה</th>
            <th>תאריך</th>
            <th>שבוע</th>
            <th>מדינה</th>
            <th>סכום מקור</th>
            <th>עמלה</th>
            <th>סה״כ</th>
            <th>שולם</th>
            <th>זיכויים</th>
            <th>יתרה</th>
            <th>תשלום אחרון</th>
            <th>סטטוס</th>
            <th>פעולה</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={13} className="debt-breakdown-table__empty">
                אין הזמנות עם יתרה פתוחה
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.orderId} className={!r.visibleInIntakeWeek ? "is-hidden-week" : undefined}>
                <td>
                  <button type="button" className="debt-breakdown-link" dir="ltr" onClick={() => onOrderClick(r.orderId)}>
                    {r.orderNumber}
                  </button>
                </td>
                <td dir="ltr">{r.orderDateYmd}</td>
                <td dir="ltr">{r.weekCode ?? "—"}</td>
                <td>{r.sourceCountry ?? "—"}</td>
                <td dir="ltr">{money(r.originalAmount)}</td>
                <td dir="ltr">{money(r.commission)}</td>
                <td dir="ltr">{money(r.totalDue)}</td>
                <td dir="ltr">{money(r.paidAmount)}</td>
                <td dir="ltr">{r.creditedAmount > 0 ? money(r.creditedAmount) : "—"}</td>
                <td dir="ltr" className="debt-breakdown-table__bal">
                  {money(r.remainingBalance)}
                </td>
                <td dir="ltr">{r.lastPaymentDate ?? "—"}</td>
                <td>
                  <span className={`debt-breakdown-status is-${r.status}`}>{r.statusLabel}</span>
                </td>
                <td>
                  <button type="button" className="debt-breakdown-iconbtn" title="פירוט הזמנה" onClick={() => onOrderClick(r.orderId)}>
                    <Eye size={14} />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default OpenDebtOrdersTable;
