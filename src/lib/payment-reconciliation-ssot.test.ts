import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPaymentReconciliation,
  buildPaymentReconciliation,
  paymentReconciliationInvariantsHold,
} from "@/lib/payment-reconciliation-ssot";

describe("payment reconciliation SSOT", () => {
  it("027: received 800 applied 758.01 surplus 41.99 commission after 0", () => {
    const row = assertPaymentReconciliation(
      buildPaymentReconciliation({
        openDebtBefore: 758.01,
        receivedAmount: 800,
        appliedToDebt: 758.01,
        surplusToCommission: 41.99,
      }),
    );
    assert.equal(row.openDebtAfter, 0);
    assert.equal(row.surplusAmount, 41.99);
    assert.equal(row.surplusDestination, "commission");
    assert.equal(row.unallocated, 0);
    assert.ok(paymentReconciliationInvariantsHold(row));
  });

  it("does not treat received as debt reduction", () => {
    const row = buildPaymentReconciliation({
      openDebtBefore: 758.01,
      receivedAmount: 800,
      appliedToDebt: 758.01,
      surplusToCommission: 41.99,
    });
    assert.notEqual(row.openDebtAfter, -41.99);
    assert.equal(row.openDebtAfter, 0);
  });

  it("016: surplus to credit", () => {
    const row = assertPaymentReconciliation(
      buildPaymentReconciliation({
        openDebtBefore: 2726.17,
        receivedAmount: 3500,
        appliedToDebt: 2726.17,
        surplusToCredit: 773.83,
      }),
    );
    assert.equal(row.openDebtAfter, 0);
    assert.equal(row.surplusDestination, "credit");
  });

  it("026: all commission, debt unchanged at 0", () => {
    const row = assertPaymentReconciliation(
      buildPaymentReconciliation({
        openDebtBefore: 0,
        receivedAmount: 800,
        appliedToDebt: 0,
        surplusToCommission: 800,
      }),
    );
    assert.equal(row.openDebtAfter, 0);
    assert.equal(row.appliedToDebt, 0);
  });
});
