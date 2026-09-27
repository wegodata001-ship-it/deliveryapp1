import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentCustomerFinancialScope,
  historicalCustomerFinancialScope,
  informationalNetPositionUsd,
  normalizeCustomerAccountBalanceQuery,
  resolveBalancesWeekFinancialScope,
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

  it("selected week AH-141 cutoff is Saturday 26/09, not previous week", () => {
    const now = new Date(2026, 8, 27, 12, 0, 0, 0);
    const resolved = resolveBalancesWeekFinancialScope({
      selectedWeekCode: "AH-141",
      sourceCountry: "TURKEY",
      now,
    });
    assert.equal(resolved.weekCode, "AH-141");
    assert.equal(resolved.cutoffYmd, "2026-09-26");
    assert.equal(resolved.cutoffWeekCode, "AH-141");
    assert.equal(resolved.financial.kind, "HISTORICAL");
    assert.equal(resolved.financial.cutoffYmd, "2026-09-26");
  });

  it("selected current week AH-142 is CURRENT, not previous Saturday", () => {
    const now = new Date(2026, 8, 27, 12, 0, 0, 0);
    const resolved = resolveBalancesWeekFinancialScope({
      selectedWeekCode: "AH-142",
      sourceCountry: "TURKEY",
      now,
    });
    assert.equal(resolved.weekCode, "AH-142");
    assert.equal(resolved.cutoffYmd, "2026-10-03");
    assert.equal(resolved.financial.kind, "CURRENT");
    assert.equal(resolved.financial.cutoffYmd ?? null, null);
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
