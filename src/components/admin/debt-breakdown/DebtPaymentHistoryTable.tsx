"use client";

import { formatUsdDisplay } from "@/lib/money-format";
import type { DebtBreakdownPaymentRow } from "@/lib/customer-debt-breakdown-types";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function DebtPaymentHistoryTable({ rows }: { rows: DebtBreakdownPaymentRow[] }) {
  const active = rows.filter((r) => !r.isCancelled);
  const cancelled = rows.filter((r) => r.isCancelled);

  return (
    <div className="debt-breakdown-table-wrap">
      <table className="debt-breakdown-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>קוד תשלום</th>
            <th>סכום</th>
            <th>מטבע</th>
            <th>אמצעי תשלום</th>
            <th>הזמנה</th>
            <th>הוקצה</th>
            <th>יתרה אחרי</th>
            <th>משתמש</th>
          </tr>
        </thead>
        <tbody>
          {active.length === 0 ? (
            <tr>
              <td colSpan={9} className="debt-breakdown-table__empty">
                אין תשלומים פעילים
              </td>
            </tr>
          ) : (
            active.map((r) => (
              <tr key={r.id} className={r.isUnallocated ? "is-unallocated" : undefined}>
                <td dir="ltr">{r.paymentDateYmd}</td>
                <td dir="ltr">{r.paymentCode ?? "—"}</td>
                <td dir="ltr">{money(r.amountUsd)}</td>
                <td>{r.currency === "USD" ? "$" : "₪"}</td>
                <td>{r.paymentMethodLabel}</td>
                <td dir="ltr">{r.orderNumber ?? (r.isUnallocated ? "לא מוקצה" : "—")}</td>
                <td dir="ltr">{r.allocatedUsd > 0 ? money(r.allocatedUsd) : "—"}</td>
                <td dir="ltr">{r.balanceAfterUsd != null ? money(r.balanceAfterUsd) : "—"}</td>
                <td>{r.createdByName ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {cancelled.length > 0 ? (
        <>
          <h4 className="debt-breakdown-subtitle">תשלומים שבוטלו</h4>
          <table className="debt-breakdown-table">
            <tbody>
              {cancelled.map((r) => (
                <tr key={r.id} className="is-cancelled">
                  <td dir="ltr">{r.paymentDateYmd}</td>
                  <td dir="ltr">{r.paymentCode ?? "—"}</td>
                  <td dir="ltr">{money(r.amountUsd)}</td>
                  <td colSpan={6}>{r.notes ?? "בוטל"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

export default DebtPaymentHistoryTable;
