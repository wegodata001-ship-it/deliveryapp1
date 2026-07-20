import type { DebtTransferInput, MethodBalanceRow } from "@/lib/finance-data/matching";
import { validateDebtTransfer, type ValidationResult } from "@/lib/finance-data/validators";
import { roundMoney2 } from "@/lib/finance-data/types";

/**
 * DebtTransferService — same-currency debt moves between method balances.
 * Phase 1: in-memory only. Persistence stays in legacy Matching save path.
 */
export type DebtTransferService = {
  validate(
    transfer: DebtTransferInput,
    balances: MethodBalanceRow[],
  ): ValidationResult;
  applyInMemory(
    balances: MethodBalanceRow[],
    transfers: DebtTransferInput[],
  ): MethodBalanceRow[];
};

export const debtTransferService: DebtTransferService = {
  validate(transfer, balances) {
    const from = balances.find(
      (b) => b.bucket === transfer.fromBucket && b.currency === transfer.currency,
    );
    return validateDebtTransfer({
      fromMethod: transfer.fromBucket,
      toMethod: transfer.toBucket,
      amount: transfer.amount,
      currency: transfer.currency,
      fromRemaining: from?.remaining ?? 0,
    });
  },

  applyInMemory(balances, transfers) {
    const next = balances.map((b) => ({ ...b }));
    for (const t of transfers) {
      const amount = roundMoney2(t.amount);
      if (!(amount > 0)) continue;
      const from = next.find((b) => b.bucket === t.fromBucket && b.currency === t.currency);
      const to = next.find((b) => b.bucket === t.toBucket && b.currency === t.currency);
      if (!from || !to) continue;
      const move = Math.min(amount, from.remaining);
      from.remaining = roundMoney2(Math.max(0, from.remaining - move));
      to.remaining = roundMoney2(to.remaining + move);
    }
    return next;
  },
};
