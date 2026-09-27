import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaymentPreview } from "@/lib/payment-intake-preview";

function preview(input: {
  debt: number | null;
  credit?: number;
  fees?: number;
  payment?: number;
  useExistingCredit?: boolean;
  selectedRemaining?: number;
}) {
  return buildPaymentPreview({
    financialState: {
      openDebtUsd: input.debt,
      availableCreditUsd: input.credit ?? 0,
      commissionBalanceUsd: input.fees ?? 0,
    },
    draftPaymentUsd: input.payment ?? 0,
    selectedOrdersRemainingUsd: input.selectedRemaining,
    useExistingCredit: input.useExistingCredit,
  });
}

describe("buildPaymentPreview", () => {
  it("CASE 1 — debt 1000, credit 0, payment 0 → remaining 1000", () => {
    const p = preview({ debt: 1000 });
    assert.equal(p.remainingDebt, 1000);
    assert.equal(p.projectedOverpayment, 0);
  });

  it("CASE 2 — debt 1000, payment 100 → remaining 900", () => {
    const p = preview({ debt: 1000, payment: 100 });
    assert.equal(p.remainingDebt, 900);
    assert.equal(p.draftPaymentTotal, 100);
  });

  it("CASE 3 — exclusive net then payment: 1000 − 200 − 100 = 700", () => {
    const p = preview({ debt: 1000, credit: 200, payment: 100, useExistingCredit: true });
    assert.equal(p.debtBefore, 800);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 700);
  });

  it("CASE 3 — credit always nets at SSOT, flag does not keep both books", () => {
    const p = preview({ debt: 1000, credit: 200, payment: 100, useExistingCredit: false });
    assert.equal(p.debtBefore, 800);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 700);
  });

  it("CASE 4 — overpayment: remaining 0, projected credit 50", () => {
    const p = preview({ debt: 100, payment: 150 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 50);
    assert.equal(p.projectedCredit, 50);
  });

  it("CASE 5 — credit only, no payment → remaining 0", () => {
    const p = preview({ debt: 0, credit: 100 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedCredit, 100);
  });

  it("CASE 6 — credit + payment does not create debt", () => {
    const p = preview({ debt: 0, credit: 100, payment: 50 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 50);
    assert.equal(p.projectedCredit, 150);
  });

  it("CASE 7 — fees without debt stay out of remaining", () => {
    const p = preview({ debt: 0, fees: 177.5 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.fees, 177.5);
  });

  it("does not treat unloaded SSOT as $0 when orders have remaining", () => {
    const p = preview({ debt: null, selectedRemaining: 1112, payment: 0 });
    assert.equal(p.remainingDebt, 1112);
    assert.equal(p.debtBefore, 1112);
    assert.equal(p.selectedOrdersRemaining, 1112);
  });

  it("SSOT loaded with $0 debt is the net remaining, not order leftover", () => {
    const p = preview({ debt: 0, selectedRemaining: 1112, payment: 100 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.draftPaymentTotal, 100);
    assert.equal(p.projectedCredit, 100);
  });

  it("customer 101: 2031.84 − 1273.83 = 758.01 remaining, credit 0", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83 });
    assert.equal(p.debtBefore, 758.01);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 758.01);
  });

  it("customer 101 + $100 → remaining 658.01", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83, payment: 100 });
    assert.equal(p.remainingDebt, 658.01);
    assert.equal(p.projectedCredit, 0);
  });

  it("customer 101 + $1000 → debt 0, credit 241.99", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83, payment: 1000 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedCredit, 241.99);
  });

  it("reverse books: 500 debt + 800 credit → remaining 0, credit 300", () => {
    const p = preview({ debt: 500, credit: 800 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.existingCredit, 300);
    assert.equal(p.projectedCredit, 300);
  });

  it("never returns negative remaining", () => {
    const p = preview({ debt: 80, payment: 100 });
    assert.equal(p.remainingDebt, 0);
    assert.ok(p.projectedOverpayment > 0);
  });
});
