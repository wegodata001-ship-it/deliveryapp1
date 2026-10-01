/**
 * SSOT יחיד לחשבונות לקוח.
 *
 * grossDebt            = הזמנות פעילות − תשלומים שסוגרים חוב − משיכות
 *   (CUSTOMER_CREDIT לא נספר כאן — אין double-count)
 * grossCredit          = CUSTOMER_CREDIT פעיל שלא קוזז
 * אחרי קיזוז: חוב או זכות, לעולם לא שניהם.
 * commissionBalanceUsd = ספר עמלות נפרד
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
  buildCustomerFinancialState,
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
  customerFinancialStatus,
  normalizeExclusiveCustomerBooks,
  assertExclusiveCustomerBooks,
  formatCustomerNetBalanceUsd,
  customerNetBalanceTone,
  type CustomerFinancialState,
} from "@/lib/customer-account-balances-shared";
import {
  informationalNetPositionUsd,
  normalizeCustomerAccountBalanceQuery,
  type CustomerFinancialScope,
  type CustomerFinancialScopeKind,
} from "@/lib/customer-financial-scope";

const EPS = 0.01;

export type CustomerAccountBalances = {
  customerId: string;
  openDebtUsd: number;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
  totalOrdersUsd: number;
  totalPaymentsUsd: number;
  totalWithdrawalsUsd: number;
  totalOrdersBeforeCommissionUsd: number;
  ordersCount: number;
  /** debt − credit אחרי קיזוז (חיובי = חוב, שלילי = זכות) */
  netPositionUsd: number;
  /** יתרה לתצוגה: שלילי = חוב, חיובי = זכות */
  netBalanceUsd: number;
  scopeKind: CustomerFinancialScopeKind;
  cutoffDate: string | null;
};

export {
  buildCustomerFinancialState,
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
  customerFinancialStatus,
  normalizeExclusiveCustomerBooks,
  assertExclusiveCustomerBooks,
  formatCustomerNetBalanceUsd,
  customerNetBalanceTone,
};
export type { CustomerAccountStatusKind, CustomerFinancialState, CustomerFinancialStatus } from "@/lib/customer-account-balances-shared";
export {
  currentCustomerFinancialScope,
  currentCustomerFinancialScopeForWorkCountry,
  historicalCustomerFinancialScope,
  informationalNetPositionUsd,
  resolveBalancesWeekFinancialScope,
  resolvePaymentIntakeFinancialScope,
} from "@/lib/customer-financial-scope";
export type {
  BalancesWeekFinancialScope,
  CustomerFinancialScope,
  CustomerFinancialScopeKind,
} from "@/lib/customer-financial-scope";

export function financialStateFromAccounts(accounts: CustomerAccountBalances): CustomerFinancialState {
  return buildCustomerFinancialState({
    openDebtUsd: accounts.openDebtUsd,
    availableCreditUsd: accounts.availableCreditUsd,
    commissionBalanceUsd: accounts.commissionBalanceUsd,
  });
}

function assembleCustomerAccountBalances(input: {
  customerId: string;
  openDebtSigned: number;
  availableCreditUsd: number;
  commissionBalanceUsd: number;
  totalOrdersUsd: number;
  totalPaymentsUsd: number;
  totalWithdrawalsUsd: number;
  totalOrdersBeforeCommissionUsd: number;
  ordersCount: number;
  financial: CustomerFinancialScope;
}): CustomerAccountBalances {
  const grossDebt = input.openDebtSigned > EPS ? Number(input.openDebtSigned.toFixed(2)) : 0;
  const books = normalizeExclusiveCustomerBooks({
    openDebtUsd: grossDebt,
    availableCreditUsd: input.availableCreditUsd,
  });
  return {
    customerId: input.customerId,
    openDebtUsd: books.openDebtUsd,
    availableCreditUsd: books.availableCreditUsd,
    commissionBalanceUsd: Number(input.commissionBalanceUsd.toFixed(2)),
    totalOrdersUsd: Number(input.totalOrdersUsd.toFixed(2)),
    totalPaymentsUsd: Number(input.totalPaymentsUsd.toFixed(2)),
    totalWithdrawalsUsd: Number(input.totalWithdrawalsUsd.toFixed(2)),
    totalOrdersBeforeCommissionUsd: Number(input.totalOrdersBeforeCommissionUsd.toFixed(2)),
    ordersCount: input.ordersCount,
    netPositionUsd: books.netPositionUsd,
    netBalanceUsd: books.netBalanceUsd,
    scopeKind: input.financial.kind,
    cutoffDate: input.financial.kind === "HISTORICAL" ? (input.financial.cutoffYmd ?? null) : null,
  };
}

function emptyAccounts(customerId: string, financial: CustomerFinancialScope): CustomerAccountBalances {
  return assembleCustomerAccountBalances({
    customerId,
    openDebtSigned: 0,
    availableCreditUsd: 0,
    commissionBalanceUsd: 0,
    totalOrdersUsd: 0,
    totalPaymentsUsd: 0,
    totalWithdrawalsUsd: 0,
    totalOrdersBeforeCommissionUsd: 0,
    ordersCount: 0,
    financial,
  });
}

export async function getCustomerAccountBalances(
  customerId: string,
  scope?: CustomerFinancialScope | CustomerBalanceScope,
): Promise<CustomerAccountBalances> {
  const { financial, calc } = normalizeCustomerAccountBalanceQuery(scope);
  const cid = customerId.trim();
  if (!cid) return emptyAccounts("", financial);

  const [calcRow, availableCreditUsd, commissionBalanceUsd] = await Promise.all([
    calculateCustomerBalance(cid, calc),
    getCustomerCreditBalanceUsd(cid, calc),
    getCustomerCommissionBalanceUsd(cid, calc),
  ]);

  return assembleCustomerAccountBalances({
    customerId: cid,
    openDebtSigned: Number(calcRow.balance.toFixed(2)),
    availableCreditUsd,
    commissionBalanceUsd,
    totalOrdersUsd: Number(calcRow.totalOrders.toFixed(2)),
    totalPaymentsUsd: Number(calcRow.totalPayments.toFixed(2)),
    totalWithdrawalsUsd: Number(calcRow.totalWithdrawals.toFixed(2)),
    totalOrdersBeforeCommissionUsd: Number(calcRow.totalOrdersBeforeCommission.toFixed(2)),
    ordersCount: calcRow.ordersCount,
    financial,
  });
}

export async function getCustomerAccountBalancesMany(
  customerIds: string[],
  scope?: CustomerFinancialScope | CustomerBalanceScope,
): Promise<Map<string, CustomerAccountBalances>> {
  const { financial, calc } = normalizeCustomerAccountBalanceQuery(scope);
  const ids = Array.from(new Set(customerIds.map((id) => id.trim()).filter(Boolean)));
  const out = new Map<string, CustomerAccountBalances>();
  if (ids.length === 0) return out;

  const [calcs, credits, commissions] = await Promise.all([
    calculateCustomerBalances(ids, calc),
    getCustomerCreditBalancesUsdMany(ids, calc),
    getCustomerCommissionBalancesUsdMany(ids, calc),
  ]);

  for (const id of ids) {
    const row = calcs.get(id);
    out.set(
      id,
      assembleCustomerAccountBalances({
        customerId: id,
        openDebtSigned: Number((row?.balance ?? 0).toFixed(2)),
        availableCreditUsd: credits.get(id) ?? 0,
        commissionBalanceUsd: commissions.get(id) ?? 0,
        totalOrdersUsd: Number((row?.totalOrders ?? 0).toFixed(2)),
        totalPaymentsUsd: Number((row?.totalPayments ?? 0).toFixed(2)),
        totalWithdrawalsUsd: Number((row?.totalWithdrawals ?? 0).toFixed(2)),
        totalOrdersBeforeCommissionUsd: Number((row?.totalOrdersBeforeCommission ?? 0).toFixed(2)),
        ordersCount: row?.ordersCount ?? 0,
        financial,
      }),
    );
  }
  return out;
}
