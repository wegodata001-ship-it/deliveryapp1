"use client";

import type { ExchangeProfitOrderRowDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { ExchangeProfitOrderRow } from "./ExchangeProfitOrderRow";

export type ExchangeProfitTableProps = {
  orders: ExchangeProfitOrderRowDto[];
  onOpenOrder: (orderId: string) => void;
};

export function ExchangeProfitTable({ orders, onOpenOrder }: ExchangeProfitTableProps) {
  if (orders.length === 0) {
    return (
      <div className="xp-empty">
        <p>אין הזמנות עם הפרש שערי מט״ח בשבוע זה.</p>
      </div>
    );
  }

  return (
    <div className="xp-table" role="list">
      {orders.map((row) => (
        <ExchangeProfitOrderRow key={row.orderId} row={row} onOpen={onOpenOrder} />
      ))}
    </div>
  );
}

export default ExchangeProfitTable;
