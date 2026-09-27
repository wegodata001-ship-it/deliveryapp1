import type { CustomerBalanceRow } from "@/app/admin/balances/actions";
import { parseMoneyStringOrZero } from "@/lib/money-format";

export type CustomerOrdersUsdSplit = {
  beforeUsd: number;
  commissionUsd: number;
  includingUsd: number;
  withdrawalUsd: number;
};

/** פיצול תצוגתי ב-USD — מנתוני שורה (SSOT מהשרת). */
export function rowOrdersUsdSplit(row: CustomerBalanceRow): CustomerOrdersUsdSplit {
  const beforeUsd = parseMoneyStringOrZero(row.ordersBeforeCommissionUSD);
  const includingUsd = parseMoneyStringOrZero(row.totalOrdersUSD);
  const withdrawalUsd = parseMoneyStringOrZero(row.codeWithdrawalUSD);
  const commissionUsd = Math.max(0, includingUsd - beforeUsd);
  return { beforeUsd, commissionUsd, includingUsd, withdrawalUsd };
}

export const OPEN_BALANCE_EPS = 0.01;

/** חוב פתוח (USD) — totalBalanceUSD כפי שמוחזר מהשרת (עסקי, ≥ 0) */
export function rowOpenBalanceUsd(row: CustomerBalanceRow): number {
  return Math.max(0, parseMoneyStringOrZero(row.totalBalanceUSD));
}

export function rowAvailableCreditUsd(row: CustomerBalanceRow): number {
  return Math.max(0, parseMoneyStringOrZero(row.availableCreditUSD ?? "0"));
}

/** SSOT netBalanceUsd בלבד — לא debt − credit ב-UI. */
export function rowNetBalanceUsd(row: CustomerBalanceRow): number {
  return parseMoneyStringOrZero(row.netBalanceUsd);
}

export function customerHasOpenBalance(row: CustomerBalanceRow): boolean {
  return rowOpenBalanceUsd(row) > OPEN_BALANCE_EPS;
}

/** @deprecated alias */
export function rowOpenDebtUsd(row: CustomerBalanceRow): number {
  return rowOpenBalanceUsd(row);
}

export function sumOrdersUsdSplit(rows: readonly CustomerBalanceRow[]): CustomerOrdersUsdSplit {
  let beforeUsd = 0;
  let commissionUsd = 0;
  let includingUsd = 0;
  let withdrawalUsd = 0;
  for (const row of rows) {
    const s = rowOrdersUsdSplit(row);
    beforeUsd += s.beforeUsd;
    commissionUsd += s.commissionUsd;
    includingUsd += s.includingUsd;
    withdrawalUsd += s.withdrawalUsd;
  }
  return { beforeUsd, commissionUsd, includingUsd, withdrawalUsd };
}
