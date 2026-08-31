/**
 * SSOT יחיד לחשבונות לקוח — שלושה חשבונות נפרדים, בלי ערבוב.
 *
 * openDebtUsd          = הזמנות פעילות − תשלומים שסוגרים חוב − משיכות
 * availableCreditUsd   = CUSTOMER_CREDIT פעיל שלא קוזז
 * commissionBalanceUsd = עמלות הזמנה + תנועות עמלה (לא תשלום שסוגר חוב)
 */
import type { CustomerBalanceScope } from "@/lib/customer-balance-calculator";
import {
  calculateCustomerBalance,
  calculateCustomerBalances,
} from "@/lib/customer-balance-calculator";
import {
  getCustomerCommissionBalanceUsd,
  getCustomerCommissionBalancesUsdMany,
} from "@/lib/customer-commission-balance";
import {
  getCustomerCreditBalanceUsd,
  getCustomerCreditBalancesUsdMany,
} from "@/lib/customer-credit-balance";
import {
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
} from "@/lib/customer-account-balances-shared";

const EPS = 0.01;

export type CustomerAccountBalances = {
  customerId: string;
  openDebtUsd: number;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
  totalOrdersUsd: number;
  totalPaymentsUsd: number;
  totalWithdrawalsUsd: number;
};

export {
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
};
export type { CustomerAccountStatusKind } from "@/lib/customer-account-balances-shared";

export async function getCustomerAccountBalances(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<CustomerAccountBalances> {
  const cid = customerId.trim();
  if (!cid) {
    return {
      customerId: "",
      openDebtUsd: 0,
      availableCreditUsd: 0,
      commissionBalanceUsd: 0,
      totalOrdersUsd: 0,
      totalPaymentsUsd: 0,
      totalWithdrawalsUsd: 0,
    };
  }

  const [calc, availableCreditUsd, commissionBalanceUsd] = await Promise.all([
    calculateCustomerBalance(cid, scope),
    getCustomerCreditBalanceUsd(cid, scope),
    getCustomerCommissionBalanceUsd(cid),
  ]);

  const signed = Number(calc.balance.toFixed(2));
  return {
    customerId: cid,
    openDebtUsd: signed > EPS ? signed : 0,
    availableCreditUsd,
    commissionBalanceUsd,
    totalOrdersUsd: Number(calc.totalOrders.toFixed(2)),
    totalPaymentsUsd: Number(calc.totalPayments.toFixed(2)),
    totalWithdrawalsUsd: Number(calc.totalWithdrawals.toFixed(2)),
  };
}

export async function getCustomerAccountBalancesMany(
  customerIds: string[],
  scope: CustomerBalanceScope = {},
): Promise<Map<string, CustomerAccountBalances>> {
  const ids = Array.from(new Set(customerIds.map((id) => id.trim()).filter(Boolean)));
  const out = new Map<string, CustomerAccountBalances>();
  if (ids.length === 0) return out;

  const [calcs, credits, commissions] = await Promise.all([
    calculateCustomerBalances(ids, scope),
    getCustomerCreditBalancesUsdMany(ids, scope),
    getCustomerCommissionBalancesUsdMany(ids),
  ]);

  for (const id of ids) {
    const calc = calcs.get(id);
    const signed = Number((calc?.balance ?? 0).toFixed(2));
    out.set(id, {
      customerId: id,
      openDebtUsd: signed > EPS ? signed : 0,
      availableCreditUsd: credits.get(id) ?? 0,
      commissionBalanceUsd: commissions.get(id) ?? 0,
      totalOrdersUsd: Number((calc?.totalOrders ?? 0).toFixed(2)),
      totalPaymentsUsd: Number((calc?.totalPayments ?? 0).toFixed(2)),
      totalWithdrawalsUsd: Number((calc?.totalWithdrawals ?? 0).toFixed(2)),
    });
  }
  return out;
}
