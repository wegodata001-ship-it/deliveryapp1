import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignAllocationToCustomerDebtSurplus,
  canSaveSurplusWithoutOrderAllocation,
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
