/**
 * Public matching DTOs (types only).
 * Engine functions stay internal under matching/ — not exported from the barrel.
 */

export type {
  MethodBalanceStatus,
  MethodBalanceRow,
  EnteredBucketAmount,
  DebtTransferInput,
  MatchingEngineInput,
  MethodApplyLine,
  MatchingEngineResult,
  DualCurrencyMatchingResult,
} from "@/lib/finance-data/matching/matching-engine";

export type { PaymentBucketKey, MatchingCurrency } from "@/lib/finance-data/matching/payment-buckets";
