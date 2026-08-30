import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import { resolveOrderSourceWeekCode } from "@/lib/payment-intake-week-context";

describe("defaultPaymentIntakeWeekCode", () => {
  it("בית AH-136 → קליטה AH-137 → הזמנות AH-136", () => {
    const payment = defaultPaymentIntakeWeekCode("AH-136");
    assert.equal(payment, "AH-137");
    assert.equal(resolveOrderSourceWeekCode(payment), "AH-136");
  });

  it("בית AH-137 → קליטה AH-138 → הזמנות AH-137", () => {
    const payment = defaultPaymentIntakeWeekCode("AH-137");
    assert.equal(payment, "AH-138");
    assert.equal(resolveOrderSourceWeekCode(payment), "AH-137");
  });

  it("בית AH-138 → קליטה AH-139 → הזמנות AH-138", () => {
    const payment = defaultPaymentIntakeWeekCode("AH-138");
    assert.equal(payment, "AH-139");
    assert.equal(resolveOrderSourceWeekCode(payment), "AH-138");
  });

  it("נורמליזציה של קלט", () => {
    assert.equal(defaultPaymentIntakeWeekCode(" ah-136 "), "AH-137");
  });
});
