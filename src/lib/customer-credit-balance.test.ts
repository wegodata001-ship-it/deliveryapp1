import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundMoney2 } from "@/lib/payment-updated";

describe("customer credit balance — pure logic", () => {
  it("exact payment — no credit", () => {
    const debt = 100;
    const payment = 100;
    const surplus = roundMoney2(Math.max(0, payment - debt));
    assert.equal(surplus, 0);
  });

  it("overpayment $10 — credit equals surplus", () => {
    const debt = 100;
    const payment = 110;
    const surplus = roundMoney2(Math.max(0, payment - debt));
    assert.equal(surplus, 10);
    const creditAfter = roundMoney2(0 + surplus);
    assert.equal(creditAfter, 10);
  });

  it("accumulates existing credit with new surplus", () => {
    const existing = 0.7;
    const newSurplus = 5.3;
    const total = roundMoney2(existing + newSurplus);
    assert.equal(total, 6);
  });

  it("applying credit reduces balance to zero", () => {
    const debt = 50;
    const credit = 15;
    const applied = Math.min(credit, debt);
    const remainingDebt = roundMoney2(debt - applied);
    const creditLeft = roundMoney2(credit - applied);
    assert.equal(remainingDebt, 35);
    assert.equal(creditLeft, 0);
  });
});
