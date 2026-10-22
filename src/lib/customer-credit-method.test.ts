import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creditSurplusSlicesFromExistingAllocation } from "@/lib/customer-credit-method";

describe("creditSurplusSlicesFromExistingAllocation", () => {
  it("TEST 5 — cash surplus keeps CASH", () => {
    const slices = creditSurplusSlicesFromExistingAllocation({
      unallocatedUsd: 28.9,
      excessByMethod: [{ method: "CASH", label: "מזומן", excessUsd: 28.9 }],
      fallbackMethod: "OTHER",
      fallbackLabel: "אחר",
    });
    assert.deepEqual(slices, [
      { method: "CASH", label: "מזומן", amountUsd: 28.9, currency: undefined },
    ]);
  });

  it("TEST 5 — bank-transfer surplus keeps BANK_TRANSFER", () => {
    const slices = creditSurplusSlicesFromExistingAllocation({
      unallocatedUsd: 28.9,
      excessByMethod: [{ method: "BANK_TRANSFER", label: "העברה בנקאית", excessUsd: 28.9 }],
      fallbackMethod: "OTHER",
      fallbackLabel: "אחר",
    });
    assert.equal(slices.length, 1);
    assert.equal(slices[0]?.method, "BANK_TRANSFER");
    assert.equal(slices[0]?.amountUsd, 28.9);
  });

  it("TEST 5 — mixed surplus keeps both methods", () => {
    const slices = creditSurplusSlicesFromExistingAllocation({
      unallocatedUsd: 40,
      excessByMethod: [
        { method: "BANK_TRANSFER", label: "העברה בנקאית", excessUsd: 30 },
        { method: "CASH", label: "מזומן", excessUsd: 10 },
      ],
      fallbackMethod: "OTHER",
      fallbackLabel: "אחר",
    });
    assert.equal(slices.length, 2);
    assert.equal(slices[0]?.method, "BANK_TRANSFER");
    assert.equal(slices[0]?.amountUsd, 30);
    assert.equal(slices[1]?.method, "CASH");
    assert.equal(slices[1]?.amountUsd, 10);
  });

  it("does not invent a new allocation order when slices do not sum", () => {
    const slices = creditSurplusSlicesFromExistingAllocation({
      unallocatedUsd: 28.9,
      excessByMethod: [
        { method: "BANK_TRANSFER", label: "העברה בנקאית", excessUsd: 10 },
        { method: "CASH", label: "מזומן", excessUsd: 5 },
      ],
      fallbackMethod: "BANK_TRANSFER",
      fallbackLabel: "העברה בנקאית",
    });
    assert.equal(slices.length, 1);
    assert.equal(slices[0]?.method, "BANK_TRANSFER");
    assert.equal(slices[0]?.amountUsd, 28.9);
  });
});
