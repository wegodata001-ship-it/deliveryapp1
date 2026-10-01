import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignAllocationToCustomerDebtSurplus,
  assertCommissionIsSurplusOnly,
  canSaveSurplusWithoutOrderAllocation,
  commissionEntriesFromCanonicalSurplus,
  commissionWriteAmount,
  paymentSurplusInvariantHolds,
  resolveSurplusDestinationAmounts,
  splitPaymentAgainstCustomerDebt,
} from "@/lib/payment-debt-surplus-split";

describe("splitPaymentAgainstCustomerDebt", () => {
  it("A exact: debt 1515 pay 1515 → allocate all, no surplus", () => {
    const s = splitPaymentAgainstCustomerDebt(1515, 1515);
    assert.equal(s.allocateToDebtUsd, 1515);
    assert.equal(s.surplusUsd, 0);
  });

  it("B shortfall: debt 1515 pay 1500 → allocate 1500, no surplus", () => {
    const s = splitPaymentAgainstCustomerDebt(1515, 1500);
    assert.equal(s.allocateToDebtUsd, 1500);
    assert.equal(s.surplusUsd, 0);
  });

  it("C overpay credit: debt 1515 pay 1530 → allocate 1515, surplus 15", () => {
    const s = splitPaymentAgainstCustomerDebt(1515, 1530);
    assert.equal(s.allocateToDebtUsd, 1515);
    assert.equal(s.surplusUsd, 15);
  });
});

describe("alignAllocationToCustomerDebtSurplus", () => {
  it("peels $15 over-allocation into unallocated for customer credit", () => {
    const r = alignAllocationToCustomerDebtSurplus({
      allocationEntries: [
        ["a", 500],
        ["b", 500],
        ["c", 530],
      ],
      customerOpenDebtUsd: 1515,
      paymentUsd: 1530,
    });
    const sum = r.allocationEntries.reduce((s, [, a]) => s + a, 0);
    assert.equal(sum, 1515);
    assert.equal(r.unallocatedUsd, 15);
    assert.ok(r.allocationEntries.length >= 1);
  });

  it("keeps full allocation when payment equals debt", () => {
    const r = alignAllocationToCustomerDebtSurplus({
      allocationEntries: [["a", 1515]],
      customerOpenDebtUsd: 1515,
      paymentUsd: 1515,
    });
    assert.equal(r.allocationEntries[0]![1], 1515);
    assert.equal(r.unallocatedUsd, 0);
  });
});

describe("canSaveSurplusWithoutOrderAllocation", () => {
  it("allows credit-only when no open debt left to allocate", () => {
    assert.equal(
      canSaveSurplusWithoutOrderAllocation({
        surplusAsCredit: true,
        surplusToCommission: false,
        unallocatedUsd: 15,
        customerOpenDebtUsd: 0,
      }),
      true,
    );
  });

  it("does NOT allow skipping allocation when customer still has open debt", () => {
    assert.equal(
      canSaveSurplusWithoutOrderAllocation({
        surplusAsCredit: true,
        surplusToCommission: false,
        unallocatedUsd: 1530,
        customerOpenDebtUsd: 1515,
      }),
      false,
    );
  });

  it("allows commission surplus with no remaining debt", () => {
    assert.equal(
      canSaveSurplusWithoutOrderAllocation({
        surplusAsCredit: false,
        surplusToCommission: true,
        unallocatedUsd: 15,
        customerOpenDebtUsd: 0,
      }),
      true,
    );
  });
});

describe("payment surplus to commission — received is not commission", () => {
  it("CASE 1: debt 758.01 received 800 COMMISSION → apply 758.01, commission 41.99", () => {
    const split = splitPaymentAgainstCustomerDebt(758.01, 800);
    assert.equal(split.receivedAmount, 800);
    assert.equal(split.debtBefore, 758.01);
    assert.equal(split.debtApplied, 758.01);
    assert.equal(split.surplusAmount, 41.99);
    assert.equal(paymentSurplusInvariantHolds(split), true);
    const dest = resolveSurplusDestinationAmounts(split, "commission");
    assert.equal(dest.toCommission, 41.99);
    assert.equal(dest.toCredit, 0);
    assert.doesNotThrow(() =>
      assertCommissionIsSurplusOnly({
        receivedAmount: 800,
        debtApplied: 758.01,
        commissionAmount: dest.toCommission,
      }),
    );
  });

  it("CASE 2: debt 758.01 received 800 CREDIT → credit 41.99, commission 0", () => {
    const dest = resolveSurplusDestinationAmounts(
      splitPaymentAgainstCustomerDebt(758.01, 800),
      "credit",
    );
    assert.equal(dest.toCredit, 41.99);
    assert.equal(dest.toCommission, 0);
  });

  it("CASE 3: debt 758.01 received 500 → apply 500, no surplus", () => {
    const split = splitPaymentAgainstCustomerDebt(758.01, 500);
    assert.equal(split.debtApplied, 500);
    assert.equal(split.surplusAmount, 0);
    assert.equal(commissionWriteAmount(split, "commission"), 0);
  });

  it("CASE 4: debt 0 received 800 COMMISSION → entire 800 may go to commission", () => {
    const split = splitPaymentAgainstCustomerDebt(0, 800);
    assert.equal(split.debtApplied, 0);
    assert.equal(split.surplusAmount, 800);
    assert.equal(commissionWriteAmount(split, "commission"), 800);
    assert.doesNotThrow(() =>
      assertCommissionIsSurplusOnly({
        receivedAmount: 800,
        debtApplied: 0,
        commissionAmount: 800,
      }),
    );
  });

  it("rejects writing receivedAmount as commission when debt was closed", () => {
    assert.throws(
      () =>
        assertCommissionIsSurplusOnly({
          receivedAmount: 800,
          debtApplied: 758.01,
          commissionAmount: 800,
        }),
      /העודף בלבד|כל סכום הקליטה/,
    );
  });

  it("does not use method totals $500+$300 as commission when surplus is $41.99", () => {
    const rows = commissionEntriesFromCanonicalSurplus(
      41.99,
      [
        { label: "BANK", surplusUsd: 500 },
        { label: "CASH", surplusUsd: 300 },
      ],
      { label: "OTHER", surplusUsd: 0 },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.surplusUsd, 41.99);
  });

  it("keeps per-method split only when it equals canonical surplus", () => {
    const rows = commissionEntriesFromCanonicalSurplus(
      41.99,
      [{ label: "CASH", surplusUsd: 41.99 }],
      { label: "OTHER", surplusUsd: 0 },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.label, "CASH");
    assert.equal(rows[0]?.surplusUsd, 41.99);
  });
});
