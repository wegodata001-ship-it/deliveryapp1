"use client";

import { formatMoneyAmount } from "@/lib/money-format";
import { formatSignedUsdDisplay } from "@/lib/debt-withdrawal-order";
import type { OrdersResultSummary } from "@/lib/orders-list-result-summary";
import type { OrdersKpiFilterKey } from "@/lib/orders-status-kpi-filter";

function moneyCell(n: number): string {
  if (n < -0.0001) return `$${formatSignedUsdDisplay(n)}`;
  return `$${formatMoneyAmount(n)}`;
}

const TONE: Record<OrdersKpiFilterKey, string> = {
  open: "adm-orders-result-summary__row--open",
  inProgress: "adm-orders-result-summary__row--progress",
  completed: "adm-orders-result-summary__row--completed",
  operationalCompleted: "adm-orders-result-summary__row--operational",
  debtWithdrawal: "adm-orders-result-summary__row--withdrawal",
  cancelled: "adm-orders-result-summary__row--cancelled",
};

export function OrdersResultSummaryTable({ summary }: { summary: OrdersResultSummary }) {
  return (
    <section
      className="adm-orders-result-summary"
      dir="rtl"
      aria-label="סיכום התוצאות"
      data-testid="orders-result-summary"
    >
      <h2 className="adm-orders-result-summary__title">סיכום התוצאות</h2>
      <div className="adm-orders-result-summary__wrap">
        <table className="adm-orders-result-summary__table">
          <thead>
            <tr>
              <th>סטטוס</th>
              <th>הזמנות</th>
              <th>לפני עמלה</th>
              <th>כולל עמלה</th>
              <th>יתרה</th>
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((line) => (
              <tr
                key={line.key}
                className={line.key === "total" ? "" : TONE[line.key]}
                data-summary-key={line.key}
              >
                <td>
                  <span className="adm-orders-result-summary__status">✓ {line.label}</span>
                </td>
                <td>{line.count.toLocaleString("he-IL")}</td>
                <td dir="ltr">{moneyCell(line.dealUsd)}</td>
                <td dir="ltr">{moneyCell(line.totalUsd)}</td>
                <td dir="ltr">{moneyCell(line.balanceUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="adm-orders-result-summary__total" data-summary-key="total" data-total-count={summary.total.count}>
              <td>{summary.total.label}</td>
              <td>{summary.total.count.toLocaleString("he-IL")}</td>
              <td dir="ltr">{moneyCell(summary.total.dealUsd)}</td>
              <td dir="ltr">{moneyCell(summary.total.totalUsd)}</td>
              <td dir="ltr">{moneyCell(summary.total.balanceUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
