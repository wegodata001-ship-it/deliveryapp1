import { FINANCE_EPS, nearlyEqual, roundMoney2 } from "@/lib/finance-data/types";
import type { OrderLedgerSnapshot } from "@/lib/finance-data/ledger";

export type ValidationIssue = {
  code: string;
  message: string;
  orderId?: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

/**
 * Validates Ledger arithmetic: openDebt === total − paid.
 */
export function validateLedger(
  snapshot: OrderLedgerSnapshot,
  eps: number = FINANCE_EPS,
): ValidationResult {
  const expected = roundMoney2(snapshot.totalUsd - snapshot.paidUsd);
  if (!nearlyEqual(expected, snapshot.openDebtUsd, eps)) {
    return {
      ok: false,
      issues: [
        {
          code: "LEDGER_ARITHMETIC",
          orderId: snapshot.orderId,
          message: `openDebtUsd ${snapshot.openDebtUsd} ≠ totalUsd − paidUsd (${expected})`,
        },
      ],
    };
  }
  return { ok: true, issues: [] };
}
