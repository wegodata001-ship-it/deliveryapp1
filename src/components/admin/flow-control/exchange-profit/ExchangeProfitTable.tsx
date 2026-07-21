"use client";

import type { ExchangeProfitOrderRowDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ExchangeProfitTableProps = {
  orders: ExchangeProfitOrderRowDto[];
  onOpenOrder: (orderId: string) => void;
};

function TotalsFooter({ orders }: { orders: ExchangeProfitOrderRowDto[] }) {
  let sale = 0;
  let cost = 0;
  let commission = 0;
  let expenses = 0;
  let profit = 0;
  for (const o of orders) {
    sale += fcNum(o.saleIls);
    cost += fcNum(o.costIls);
    commission += fcNum(o.commissionUsd);
    expenses += fcNum(o.expensesUsd);
    profit += fcNum(o.netIls);
  }
  return (
    <tfoot>
      <tr className="xp-data-table__totals">
        <th colSpan={2}>סה״כ השבוע ({orders.length} הזמנות)</th>
        <th dir="ltr">{fmtDailyMoney("ILS", sale)}</th>
        <th dir="ltr">{fmtDailyMoney("ILS", cost)}</th>
        <th dir="ltr">{fmtDailyMoney("USD", commission)}</th>
        <th dir="ltr">{fmtDailyMoney("USD", expenses)}</th>
        <th dir="ltr" className={profit >= 0 ? "is-profit" : "is-loss"}>
          {fmtDailyMoney("ILS", profit)}
        </th>
        <th>100%</th>
      </tr>
      <tr className="xp-data-table__totals-meta">
        <td colSpan={8}>
          סה״כ מכירות · סה״כ עלויות · סה״כ עמלות · סה״כ הוצאות · סה״כ רווח השבוע
        </td>
      </tr>
    </tfoot>
  );
}

export function ExchangeProfitTable({ orders, onOpenOrder }: ExchangeProfitTableProps) {
  if (orders.length === 0) {
    return (
      <div className="xp-empty">
        <p>אין הזמנות עם הפרש שערי מט״ח בתקופה שנבחרה.</p>
      </div>
    );
  }

  return (
    <div className="xp-data-table-wrap">
      <table className="xp-data-table">
        <thead>
          <tr>
            <th>הזמנה</th>
            <th>לקוח</th>
            <th className="xp-num">סכום מכירה</th>
            <th className="xp-num">עלות</th>
            <th className="xp-num">עמלה</th>
            <th className="xp-num">הוצאות</th>
            <th className="xp-num">רווח</th>
            <th className="xp-num">תרומה</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((row) => {
            const net = fcNum(row.netIls);
            return (
              <tr
                key={row.orderId}
                className={`xp-data-table__row xp-data-table__row--${row.status}`}
                onClick={() => onOpenOrder(row.orderId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenOrder(row.orderId);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`פירוט הזמנה ${row.orderNumber ?? row.orderId}`}
              >
                <td dir="ltr" className="xp-data-table__order">
                  {row.orderNumber ?? "—"}
                </td>
                <td>{row.customerName ?? "—"}</td>
                <td dir="ltr" className="xp-num">
                  {fmtDailyMoney("ILS", fcNum(row.saleIls))}
                </td>
                <td dir="ltr" className="xp-num">
                  {fmtDailyMoney("ILS", fcNum(row.costIls))}
                </td>
                <td dir="ltr" className="xp-num">
                  {fmtDailyMoney("USD", fcNum(row.commissionUsd))}
                </td>
                <td dir="ltr" className="xp-num">
                  {fmtDailyMoney("USD", fcNum(row.expensesUsd))}
                </td>
                <td
                  dir="ltr"
                  className={`xp-num ${net >= 0 ? "is-profit" : "is-loss"}`}
                >
                  {fmtDailyMoney("ILS", net)}
                </td>
                <td dir="ltr" className="xp-num">
                  {row.contributionPct}%
                </td>
              </tr>
            );
          })}
        </tbody>
        <TotalsFooter orders={orders} />
      </table>
    </div>
  );
}

export default ExchangeProfitTable;
