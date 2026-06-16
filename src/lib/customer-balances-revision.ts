import type { CustomerBalancesPayload } from "@/app/admin/balances/actions";

/** חתימת נתונים לזיהוי שינוי בדוח (בדיקת רענון ברקע) */
export function customerBalancesDataRevision(payload: CustomerBalancesPayload): string {
  const s = payload.stats;
  return [
    payload.totalRows,
    s.totalNetBalanceUsd,
    s.totalPaymentsUsd,
    s.totalLifetimeOrdersUsd,
    s.totalOrdersAfterCommissionUsd,
    s.withDebtCount,
    s.withCreditCount,
    payload.rows[0]?.customerId ?? "",
  ].join("|");
}
