import type { CustomerBalanceRow } from "@/app/admin/balances/actions";
import { parseMoneyStringOrZero } from "@/lib/money-format";

export type CustomerOrdersUsdSplit = {
  beforeUsd: number;
  commissionUsd: number;
  includingUsd: number;
};

/** פיצול תצוגתי ב-USD מנתוני שורה קיימים (מקורי + עמלה בש״ח, סה״כ הזמנות ב-USD) */
export function rowOrdersUsdSplit(row: CustomerBalanceRow): CustomerOrdersUsdSplit {
  const includingUsd = parseMoneyStringOrZero(row.totalOrdersUSD);
  const dealsIls = parseMoneyStringOrZero(row.totalDealsILS);
  const commissionsIls = parseMoneyStringOrZero(row.totalCommissionsILS);
  const baseIls = dealsIls + commissionsIls;
  if (baseIls <= 0.01) {
    return { beforeUsd: includingUsd, commissionUsd: 0, includingUsd };
  }
  const beforeUsd = (includingUsd * dealsIls) / baseIls;
  const commissionUsd = (includingUsd * commissionsIls) / baseIls;
  return { beforeUsd, commissionUsd, includingUsd };
}

export const OPEN_BALANCE_EPS = 0.01;

/** חוב פתוח (USD) — totalBalanceUSD כפי שמוחזר מהשרת (עסקי, ≥ 0) */
export function rowOpenBalanceUsd(row: CustomerBalanceRow): number {
  return Math.max(0, parseMoneyStringOrZero(row.totalBalanceUSD));
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
  for (const row of rows) {
    const s = rowOrdersUsdSplit(row);
    beforeUsd += s.beforeUsd;
    commissionUsd += s.commissionUsd;
    includingUsd += s.includingUsd;
  }
  return { beforeUsd, commissionUsd, includingUsd };
}
