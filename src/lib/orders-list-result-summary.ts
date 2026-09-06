import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { computeOrderLedgerView, roundOrderMoney2 } from "@/lib/order-remaining-debt";
import {
  ORDERS_KPI_FILTER_KEYS,
  orderMatchesOrdersKpiFilters,
  ordersKpiLabel,
  type OrdersKpiFilterKey,
} from "@/lib/orders-status-kpi-filter";

export type OrdersResultSummaryMoneyRow = {
  id: string;
  status: string;
  isCompleted: boolean;
  amountUsd: unknown;
  commissionUsd: unknown;
  totalUsd: unknown;
  paidUsd: number;
};

export type OrdersResultSummaryLine = {
  key: OrdersKpiFilterKey | "total";
  label: string;
  count: number;
  dealUsd: number;
  totalUsd: number;
  balanceUsd: number;
};

export type OrdersResultSummary = {
  lines: OrdersResultSummaryLine[];
  total: OrdersResultSummaryLine;
};

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** אותם ערכים שמוצגים בטבלה — amountUsd / totalUsd שמורים, יתרה מ-ledger SSOT. */
export function moneyFromFilteredOrder(row: OrdersResultSummaryMoneyRow): {
  dealUsd: number;
  totalUsd: number;
  balanceUsd: number;
} {
  const dealRaw = num(row.amountUsd);
  const totalRaw = num(row.totalUsd);
  const dw = isDebtWithdrawalOrderStatus(row.status);
  const ledger = computeOrderLedgerView({
    orderId: row.id,
    totalUsd: row.totalUsd,
    amountUsd: row.amountUsd,
    commissionUsd: row.commissionUsd,
    paidUsd: dw ? 0 : row.paidUsd,
  });
  if (dw) {
    return {
      dealUsd: roundOrderMoney2(-Math.abs(dealRaw)),
      totalUsd: roundOrderMoney2(-Math.abs(totalRaw)),
      balanceUsd: 0,
    };
  }
  return {
    dealUsd: roundOrderMoney2(dealRaw),
    totalUsd: roundOrderMoney2(totalRaw),
    balanceUsd: ledger.remainingUsd,
  };
}

function emptyLine(key: OrdersKpiFilterKey | "total", label: string): OrdersResultSummaryLine {
  return { key, label, count: 0, dealUsd: 0, totalUsd: 0, balanceUsd: 0 };
}

function addMoney(line: OrdersResultSummaryLine, money: ReturnType<typeof moneyFromFilteredOrder>): void {
  line.count += 1;
  line.dealUsd = roundOrderMoney2(line.dealUsd + money.dealUsd);
  line.totalUsd = roundOrderMoney2(line.totalUsd + money.totalUsd);
  line.balanceUsd = roundOrderMoney2(line.balanceUsd + money.balanceUsd);
}

/**
 * סיכום לפי ריבועי KPI מאותו dataset מסונן של הטבלה.
 * שורות הסטטוס יכולות לחפוף (בוצע ∩ הושלם). סה״כ הוא ייחודי.
 */
export function buildOrdersResultSummary(
  rows: OrdersResultSummaryMoneyRow[],
  selectedKeys: OrdersKpiFilterKey[],
): OrdersResultSummary | null {
  if (rows.length === 0) return null;

  const keys =
    selectedKeys.length > 0
      ? ORDERS_KPI_FILTER_KEYS.filter((k) => selectedKeys.includes(k))
      : [...ORDERS_KPI_FILTER_KEYS];

  const byKey = new Map<OrdersKpiFilterKey, OrdersResultSummaryLine>();
  for (const key of keys) byKey.set(key, emptyLine(key, ordersKpiLabel(key)));

  const total = emptyLine("total", "סה״כ");
  for (const row of rows) {
    const money = moneyFromFilteredOrder(row);
    addMoney(total, money);
    for (const key of keys) {
      if (!orderMatchesOrdersKpiFilters(row, [key])) continue;
      addMoney(byKey.get(key)!, money);
    }
  }

  const lines = keys.map((k) => byKey.get(k)!).filter((line) => line.count > 0);
  if (lines.length === 0) return null;
  return { lines, total };
}
