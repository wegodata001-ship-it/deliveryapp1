import { FINANCE_EPS, nearlyEqual, roundMoney2, type FinanceBreakdownRecord } from "@/lib/finance-data/types";
import type { ValidationResult } from "./validate-ledger";

function rowRemaining(row: FinanceBreakdownRecord): number {
  if (row.remainingAmount != null) {
    return roundMoney2(Math.max(0, row.remainingAmount));
  }
  return roundMoney2(Math.max(0, row.amount - row.paidAmount));
}

/**
 * Validates that method remaining divides Ledger open debt — per currency.
 *
 * USD: Σ remainingAmount(USD) === openDebtUsd (Ledger)
 * ILS: Σ remainingAmount(ILS) === openDebtIls when openDebtIls is provided
 *
 * Hard fail codes:
 *   BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_USD
 *   BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_ILS
 */
export function validateBreakdown(params: {
  orderId: string;
  openDebtUsd: number;
  /** When set, ILS remaining must match this open ILS debt */
  openDebtIls?: number | null;
  rows: FinanceBreakdownRecord[];
  eps?: number;
}): ValidationResult {
  const eps = params.eps ?? FINANCE_EPS;
  const issues: ValidationResult["issues"] = [];

  if (params.rows.length === 0) {
    return { ok: true, issues: [] };
  }

  let sumRemainingUsd = 0;
  let sumRemainingIls = 0;

  for (const row of params.rows) {
    const remaining = rowRemaining(row);
    const derived = roundMoney2(Math.max(0, row.amount - row.paidAmount));

    if (row.remainingAmount != null && !nearlyEqual(remaining, derived, eps)) {
      issues.push({
        code: "BREAKDOWN_REMAINING_NEQ_PLANNED_MINUS_PAID",
        orderId: params.orderId,
        message: `method ${row.paymentMethod}/${row.currency}: remaining ${remaining} ≠ amount−paid ${derived} (possible debt transfer)`,
      });
    }

    if (row.currency === "USD") {
      sumRemainingUsd = roundMoney2(sumRemainingUsd + remaining);
    } else {
      sumRemainingIls = roundMoney2(sumRemainingIls + remaining);
    }
  }

  const openDebtUsd = roundMoney2(Math.max(0, params.openDebtUsd));
  if (!nearlyEqual(sumRemainingUsd, openDebtUsd, eps)) {
    issues.push({
      code: "BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_USD",
      orderId: params.orderId,
      message: `Σ remainingAmount(USD) ${sumRemainingUsd} ≠ Open Debt USD ${openDebtUsd}`,
    });
  }

  if (params.openDebtIls != null) {
    const openDebtIls = roundMoney2(Math.max(0, params.openDebtIls));
    if (!nearlyEqual(sumRemainingIls, openDebtIls, eps)) {
      issues.push({
        code: "BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_ILS",
        orderId: params.orderId,
        message: `Σ remainingAmount(ILS) ${sumRemainingIls} ≠ Open Debt ILS ${openDebtIls}`,
      });
    }
  }

  const hard = issues.filter(
    (i) =>
      i.code === "BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_USD" ||
      i.code === "BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_ILS",
  );
  return { ok: hard.length === 0, issues };
}
