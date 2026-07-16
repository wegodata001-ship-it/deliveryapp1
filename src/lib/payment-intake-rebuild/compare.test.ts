import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareReceivedToDebt, computeReceivedUsd } from "@/lib/payment-intake-rebuild/compare";
import { validatePaymentIntake } from "@/lib/payment-intake-rebuild/validate";

describe("payment-intake-rebuild compare", () => {
  it("underpay leaves open remainder", () => {
    const c = compareReceivedToDebt(100, 40);
    assert.equal(c.mode, "under");
    assert.equal(c.allocateUsd, 40);
    assert.equal(c.openRemainderUsd, 60);
    assert.equal(c.creditSurplusUsd, 0);
  });

  it("equal closes all", () => {
    const c = compareReceivedToDebt(100, 100);
    assert.equal(c.mode, "equal");
    assert.equal(c.openRemainderUsd, 0);
    assert.equal(c.creditSurplusUsd, 0);
  });

  it("overpay creates credit surplus", () => {
    const c = compareReceivedToDebt(100, 130);
    assert.equal(c.mode, "over");
    assert.equal(c.allocateUsd, 100);
    assert.equal(c.creditSurplusUsd, 30);
  });

  it("sums mixed methods to USD", () => {
    const r = computeReceivedUsd(
      [
        { id: "1", method: "CASH", amount: 350 },
        { id: "2", method: "USD", amount: 50 },
      ],
      3.5,
    );
    assert.equal(r.receivedUsd, 150);
    assert.equal(r.totalIls, 350);
  });
});

describe("payment-intake-rebuild validate", () => {
  it("requires fee description for OTHER", () => {
    const err = validatePaymentIntake({
      customerId: "c1",
      weekCode: "AH-131",
      dollarRate: 3.5,
      methods: [{ id: "1", method: "CASH", amount: 100 }],
      selectedOrderIds: ["o1"],
      closeWithFee: {
        enabled: true,
        reason: "OTHER",
        amountUsd: 5,
        description: "",
      },
    });
    assert.equal(err?.field, "fee");
  });

  it("allows negative fee amount", () => {
    const err = validatePaymentIntake({
      customerId: "c1",
      weekCode: "AH-131",
      dollarRate: 3.5,
      methods: [{ id: "1", method: "CASH", amount: 100 }],
      selectedOrderIds: ["o1"],
      closeWithFee: {
        enabled: true,
        reason: "BANK_FEE",
        amountUsd: -3,
        description: "זיכוי",
      },
    });
    assert.equal(err, null);
  });
});
