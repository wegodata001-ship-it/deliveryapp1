/**
 * Matching internals — NOT part of the public Finance Data Layer barrel.
 * Services import from here; screens must not.
 */

export {
  MATCHING_EPS,
  deriveMethodStatus,
  withMethodStatus,
  normalizeBreakdownCurrency,
  applyDebtTransfersToBalances,
  applyPaymentMethodMatching,
  applyDualCurrencyMatching,
  methodBalanceFromBreakdownRow,
  type MethodBalanceStatus,
  type MethodBalanceRow,
  type EnteredBucketAmount,
  type DebtTransferInput,
  type MatchingEngineInput,
  type MethodApplyLine,
  type MatchingEngineResult,
  type DualCurrencyMatchingResult,
} from "./matching-engine";

export {
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  normalizePaymentMethodSlug,
  normalizeMatchingCurrency,
  type PaymentBucketKey,
  type MatchingCurrency,
} from "./payment-buckets";
