import {
  applyDualCurrencyMatching,
  type DebtTransferInput,
  type DualCurrencyMatchingResult,
  type EnteredBucketAmount,
  type MethodBalanceRow,
} from "@/lib/finance-data/matching";
import { validateCurrencies, validateDebtTransfer } from "@/lib/finance-data/validators";
import type { ValidationResult } from "@/lib/finance-data/validators";

/**
 * MatchingService — dual-currency matching (compute only, no persist).
 * Uses finance-data/matching engine — not the legacy payment-method-matching-engine.
 */
export type MatchingService = {
  validateInputs(params: {
    enteredByBucket: EnteredBucketAmount[];
    debtTransfers?: DebtTransferInput[] | null;
    balances: MethodBalanceRow[];
  }): ValidationResult;
  runDual(params: {
    balances: MethodBalanceRow[];
    enteredByBucket: EnteredBucketAmount[];
    orderIdsOldestFirst: string[];
    debtTransfers?: DebtTransferInput[] | null;
    rateByOrderId: Map<string, number>;
  }): DualCurrencyMatchingResult;
};

export const matchingService: MatchingService = {
  validateInputs(params) {
    const currencyCheck = validateCurrencies({
      entered: params.enteredByBucket.map((e) => ({ currency: e.currency })),
      transfers: (params.debtTransfers ?? []).map((t) => ({ currency: t.currency })),
    });
    if (!currencyCheck.ok) return currencyCheck;

    const balanceByKey = new Map(
      params.balances.map((b) => [`${b.bucket}:${b.currency}`, b]),
    );
    const issues: ValidationResult["issues"] = [];
    for (const t of params.debtTransfers ?? []) {
      const from = balanceByKey.get(`${t.fromBucket}:${t.currency}`);
      const check = validateDebtTransfer({
        fromMethod: t.fromBucket,
        toMethod: t.toBucket,
        amount: t.amount,
        currency: t.currency,
        fromRemaining: from?.remaining ?? 0,
      });
      issues.push(...check.issues);
    }
    return { ok: issues.length === 0, issues };
  },

  runDual(params) {
    return applyDualCurrencyMatching(params);
  },
};
