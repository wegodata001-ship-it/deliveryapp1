import { FINANCE_EPS, nearlyEqual, roundMoney2 } from "@/lib/finance-data/types";
import type { ValidationResult } from "./validate-ledger";

/**
 * Validates that allocated amounts to orders do not exceed payment total (USD ledger).
 */
export function validatePaymentAllocation(params: {
  paymentAmountUsd: number;
  allocations: Array<{ orderId: string; amountUsd: number }>;
  eps?: number;
}): ValidationResult {
  const eps = params.eps ?? FINANCE_EPS;
  const issues: ValidationResult["issues"] = [];
  const sum = roundMoney2(
    params.allocations.reduce((s, a) => s + (Number.isFinite(a.amountUsd) ? a.amountUsd : 0), 0),
  );
  const payment = roundMoney2(params.paymentAmountUsd);

  if (sum > payment + eps) {
    issues.push({
      code: "ALLOCATION_EXCEEDS_PAYMENT",
      message: `Σ allocations ${sum} > payment ${payment}`,
    });
  }

  for (const a of params.allocations) {
    if (a.amountUsd < -eps) {
      issues.push({
        code: "ALLOCATION_NEGATIVE",
        orderId: a.orderId,
        message: `Negative allocation ${a.amountUsd}`,
      });
    }
  }

  // Exact cover is allowed; under-allocation (surplus) is ok for partial apply.
  if (nearlyEqual(sum, payment, eps) || sum < payment + eps) {
    // no-op
  }

  return { ok: issues.length === 0, issues };
}
