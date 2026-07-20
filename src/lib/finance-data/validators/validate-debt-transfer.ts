import { FINANCE_EPS, roundMoney2, type MoneyCurrency } from "@/lib/finance-data/types";
import type { ValidationResult } from "./validate-ledger";

export type DebtTransferCandidate = {
  fromMethod: string;
  toMethod: string;
  amount: number;
  currency: MoneyCurrency;
  fromRemaining: number;
};

/**
 * Same-currency only; amount must fit source remaining.
 */
export function validateDebtTransfer(
  transfer: DebtTransferCandidate,
  eps: number = FINANCE_EPS,
): ValidationResult {
  const issues: ValidationResult["issues"] = [];
  const amount = roundMoney2(transfer.amount);

  if (!(amount > eps)) {
    issues.push({
      code: "DEBT_TRANSFER_AMOUNT",
      message: `Transfer amount must be > ${eps}`,
    });
  }

  if (transfer.fromMethod === transfer.toMethod) {
    issues.push({
      code: "DEBT_TRANSFER_SAME_METHOD",
      message: "Cannot transfer debt to the same method",
    });
  }

  if (amount > transfer.fromRemaining + eps) {
    issues.push({
      code: "DEBT_TRANSFER_EXCEEDS_REMAINING",
      message: `Transfer ${amount} exceeds fromRemaining ${transfer.fromRemaining}`,
    });
  }

  return { ok: issues.length === 0, issues };
}
