import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentCustomerFinancialScope,
  historicalCustomerFinancialScope,
  informationalNetPositionUsd,
  normalizeCustomerAccountBalanceQuery,
  toCustomerBalanceCalcScope,
} from "@/lib/customer-financial-scope";

describe("customer financial scope contract", () => {
  it("CURRENT has no cutoff date and no calc to", () => {
    const scope = currentCustomerFinancialScope("TURKEY");
    assert.equal(scope.kind, "CURRENT");
    const calc = toCustomerBalanceCalcScope(scope);
    assert.equal(calc.to ?? null, null);
    assert.equal(calc.from ?? null, null);
    assert.equal(calc.sourceCountry, "TURKEY");
  });

  it("HISTORICAL 19/09 maps to end of that day", () => {
    const scope = historicalCustomerFinancialScope({
      cutoffYmd: "2026-09-19",
      sourceCountry: "TURKEY",
    });
    assert.equal(scope.kind, "HISTORICAL");
    const calc = toCustomerBalanceCalcScope(scope);
    assert.ok(calc.to);
    assert.equal(calc.to?.getFullYear(), 2026);
    assert.equal(calc.to?.getMonth(), 8);
    assert.equal(calc.to?.getDate(), 19);
  });

  it("net position is informational only — does not clamp books", () => {
    assert.equal(informationalNetPositionUsd(2031.84, 1273.83), 758.01);
    assert.equal(informationalNetPositionUsd(6868, 1273.83), 5594.17);
  });

  it("legacy {to} without kind becomes HISTORICAL", () => {
    const { financial } = normalizeCustomerAccountBalanceQuery({
      to: new Date(2026, 8, 19, 23, 59, 59, 999),
      sourceCountry: "TURKEY",
    });
    assert.equal(financial.kind, "HISTORICAL");
    assert.equal(financial.cutoffYmd, "2026-09-19");
  });
});
