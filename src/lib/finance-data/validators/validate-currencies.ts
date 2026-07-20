import type { MoneyCurrency } from "@/lib/finance-data/types";
import type { ValidationResult } from "./validate-ledger";

/**
 * Enforces full USD / ILS isolation on transfers and entered amounts.
 */
export function validateCurrencies(params: {
  transfers?: Array<{ currency: MoneyCurrency; fromCurrency?: MoneyCurrency; toCurrency?: MoneyCurrency }>;
  entered?: Array<{ currency: MoneyCurrency }>;
}): ValidationResult {
  const issues: ValidationResult["issues"] = [];

  for (const t of params.transfers ?? []) {
    if (t.fromCurrency && t.fromCurrency !== t.currency) {
      issues.push({
        code: "CROSS_CURRENCY_TRANSFER",
        message: `Debt transfer currency ${t.currency} ≠ fromCurrency ${t.fromCurrency}`,
      });
    }
    if (t.toCurrency && t.toCurrency !== t.currency) {
      issues.push({
        code: "CROSS_CURRENCY_TRANSFER",
        message: `Debt transfer currency ${t.currency} ≠ toCurrency ${t.toCurrency}`,
      });
    }
  }

  for (const e of params.entered ?? []) {
    if (e.currency !== "USD" && e.currency !== "ILS") {
      issues.push({
        code: "INVALID_CURRENCY",
        message: `Entered amount has invalid currency: ${String(e.currency)}`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
