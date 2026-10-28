/**
 * Customer Collectible Balance Reconciliation — SSOT for intake / PMC / preview.
 * Uses exclusive CURRENT books + week-scoped order remainings; no parallel ledger.
 */

import { roundMoney2 } from "@/lib/payment-intake";

export type CustomerCollectibleReconciliationInput = {
  /** CURRENT exclusive openDebtUsd — getCustomerAccountBalances */
  currentOpenDebtUsd: number | null;
  /** CURRENT exclusive availableCreditUsd */
  currentAvailableCreditUsd: number | null;
  /** Σ dbRemainingUsd for intake week-eligible orders */
  weekScopedOrderRemainingUsd: number;
  /** PMC / breakdown open planned remaining (method rows) */
  plannedOpenRemainingUsd: number;
  /** Optional gross credit (getCustomerCreditBalanceUsd) for gap explanation */
  grossCreditUsd?: number | null;
};

export type CustomerCollectibleReconciliation = {
  currentOpenDebtUsd: number | null;
  weekDueOrderRemainingUsd: number;
  /** Amount that may be collected now — capped by CURRENT when week sum is inflated by customer-level credit */
  netCollectibleUsd: number;
  plannedOpenRemainingUsd: number;
  /** planned open − net collectible (e.g. 2384.83 − 601 = 1783.83) */
  planningAdjustmentGapUsd: number;
  /** week order sum − net collectible */
  weekVsNetCollectibleGapUsd: number;
  creditAvailableExclusiveUsd: number;
  /** Credit already reflected in CURRENT vs order sums — informational */
  creditIncludedInCurrentUsd: number | null;
  ssotLoaded: boolean;
};

/**
 * Net collectible for the selected intake week.
 * Week orders define scope; CURRENT SSOT caps when customer-level credit already reduced books.
 */
export function resolveNetCollectibleUsd(params: {
  currentOpenDebtUsd: number | null;
  weekScopedOrderRemainingUsd: number;
  ssotLoaded: boolean;
  hasEligibleOrderSet?: boolean;
}): number {
  const week = roundMoney2(Math.max(0, params.weekScopedOrderRemainingUsd));
  if (params.hasEligibleOrderSet && week <= 0.005) return 0;
  if (!params.ssotLoaded || params.currentOpenDebtUsd == null) return week;
  const current = roundMoney2(Math.max(0, params.currentOpenDebtUsd));
  if (week <= 0.005) return current;
  return roundMoney2(Math.min(week, current));
}

export function buildCustomerCollectibleReconciliation(
  input: CustomerCollectibleReconciliationInput,
): CustomerCollectibleReconciliation {
  const ssotLoaded = input.currentOpenDebtUsd != null;
  const weekDue = roundMoney2(Math.max(0, input.weekScopedOrderRemainingUsd));
  const netCollectible = resolveNetCollectibleUsd({
    currentOpenDebtUsd: input.currentOpenDebtUsd,
    weekScopedOrderRemainingUsd: weekDue,
    ssotLoaded,
    hasEligibleOrderSet: true,
  });
  const planned = roundMoney2(Math.max(0, input.plannedOpenRemainingUsd));
  const planningGap = roundMoney2(Math.max(0, planned - netCollectible));
  const weekVsNet = roundMoney2(Math.max(0, weekDue - netCollectible));
  const creditExclusive = roundMoney2(Math.max(0, input.currentAvailableCreditUsd ?? 0));
  const gross =
    input.grossCreditUsd != null && Number.isFinite(input.grossCreditUsd)
      ? roundMoney2(Math.max(0, input.grossCreditUsd))
      : null;
  let creditIncluded: number | null = null;
  if (gross != null && gross > creditExclusive + 0.005) {
    creditIncluded = roundMoney2(gross - creditExclusive);
  } else if (weekVsNet > 0.005) {
    creditIncluded = weekVsNet;
  }

  return {
    currentOpenDebtUsd: input.currentOpenDebtUsd,
    weekDueOrderRemainingUsd: weekDue,
    netCollectibleUsd: netCollectible,
    plannedOpenRemainingUsd: planned,
    planningAdjustmentGapUsd: planningGap,
    weekVsNetCollectibleGapUsd: weekVsNet,
    creditAvailableExclusiveUsd: creditExclusive,
    creditIncludedInCurrentUsd: creditIncluded,
    ssotLoaded,
  };
}
