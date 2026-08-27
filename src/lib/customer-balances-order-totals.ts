import type { CustomerBalanceRow } from "@/app/admin/balances/actions";
import {
  orderBeforeCommissionUsd,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
  type OrderMoneyUsdFields,
} from "@/lib/debt-withdrawal-order";
import { parseMoneyStringOrZero } from "@/lib/money-format";

/** סיכום USD לפי הזמנות — SSOT לדוח יתרות (KPI + שורות). */
export type CustomerOrderUsdTotals = {
  beforeCommissionUsd: number;
  afterCommissionUsd: number;
  codeWithdrawalUsd: number;
};

export function orderUsdTotalsFromFields(o: OrderMoneyUsdFields): CustomerOrderUsdTotals {
  return {
    beforeCommissionUsd: orderBeforeCommissionUsd(o),
    afterCommissionUsd: orderCustomerChargeUsd(o),
    codeWithdrawalUsd: orderCustomerCreditUsd(o),
  };
}

export function rowOrderUsdTotals(row: CustomerBalanceRow): CustomerOrderUsdTotals {
  return {
    beforeCommissionUsd: parseMoneyStringOrZero(row.ordersBeforeCommissionUSD),
    afterCommissionUsd: parseMoneyStringOrZero(row.totalOrdersUSD),
    codeWithdrawalUsd: parseMoneyStringOrZero(row.codeWithdrawalUSD),
  };
}

export function sumCustomerOrderUsdTotals(rows: readonly CustomerBalanceRow[]): CustomerOrderUsdTotals {
  let beforeCommissionUsd = 0;
  let afterCommissionUsd = 0;
  let codeWithdrawalUsd = 0;
  for (const row of rows) {
    const t = rowOrderUsdTotals(row);
    beforeCommissionUsd += t.beforeCommissionUsd;
    afterCommissionUsd += t.afterCommissionUsd;
    codeWithdrawalUsd += t.codeWithdrawalUsd;
  }
  return { beforeCommissionUsd, afterCommissionUsd, codeWithdrawalUsd };
}
