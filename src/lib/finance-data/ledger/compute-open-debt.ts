/**
 * Ledger — source of truth for order open debt (USD).
 *
 * Open Debt = Order.totalUsd − Σ ACTIVE Payment.amountUsd
 *
 * Not OrderPaymentBreakdown. Not Matching remainingAmount. Not UI form state.
 */

import { FINANCE_EPS, roundMoney2 } from "@/lib/finance-data/types";

export type LedgerBalanceStatus = "paid" | "open" | "credit";

export type OrderLedgerSnapshot = {
  orderId: string;
  totalUsd: number;
  paidUsd: number;
  /** Positive = customer still owes; negative = credit / overpay */
  openDebtUsd: number;
  status: LedgerBalanceStatus;
};

export function ledgerStatus(openDebtUsd: number, eps: number = FINANCE_EPS): LedgerBalanceStatus {
  if (openDebtUsd > eps) return "open";
  if (openDebtUsd < -eps) return "credit";
  return "paid";
}

export function computeOpenDebtUsd(params: {
  orderId: string;
  totalUsd: number;
  paidUsd: number;
  eps?: number;
}): OrderLedgerSnapshot {
  const totalUsd = roundMoney2(params.totalUsd);
  const paidUsd = roundMoney2(params.paidUsd);
  const openDebtUsd = roundMoney2(totalUsd - paidUsd);
  return {
    orderId: params.orderId,
    totalUsd,
    paidUsd,
    openDebtUsd,
    status: ledgerStatus(openDebtUsd, params.eps),
  };
}

/** Sum ACTIVE payment amounts (already filtered by repository). */
export function sumPaymentAmountUsd(payments: Array<{ amountUsd: number }>): number {
  return roundMoney2(payments.reduce((s, p) => s + (Number.isFinite(p.amountUsd) ? p.amountUsd : 0), 0));
}
