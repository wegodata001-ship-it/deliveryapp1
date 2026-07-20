import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOpenDebtUsd, sumPaymentAmountUsd } from "./compute-open-debt";
import { validateBreakdown } from "@/lib/finance-data/validators";

describe("finance-data ledger", () => {
  it("computes Open Debt as total − paid", () => {
    const snap = computeOpenDebtUsd({
      orderId: "o1",
      totalUsd: 100,
      paidUsd: 40,
    });
    assert.equal(snap.openDebtUsd, 60);
    assert.equal(snap.status, "open");
  });

  it("marks credit when paid exceeds total", () => {
    const snap = computeOpenDebtUsd({
      orderId: "o1",
      totalUsd: 100,
      paidUsd: 120,
    });
    assert.equal(snap.openDebtUsd, -20);
    assert.equal(snap.status, "credit");
  });

  it("sums payment amounts", () => {
    assert.equal(sumPaymentAmountUsd([{ amountUsd: 10.1 }, { amountUsd: 20.2 }]), 30.3);
  });
});

describe("finance-data validateBreakdown", () => {
  it("fails when Σ remainingAmount(USD) ≠ Open Debt", () => {
    const result = validateBreakdown({
      orderId: "o1",
      openDebtUsd: 100,
      rows: [
        {
          id: "b1",
          orderId: "o1",
          paymentMethod: "CASH",
          amount: 60,
          currency: "USD",
          paidAmount: 0,
          remainingAmount: 60,
        },
        {
          id: "b2",
          orderId: "o1",
          paymentMethod: "BIT",
          amount: 30,
          currency: "USD",
          paidAmount: 0,
          remainingAmount: 30,
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === "BREAKDOWN_REMAINING_NEQ_OPEN_DEBT_USD"));
  });

  it("passes when Σ remainingAmount(USD) === Open Debt", () => {
    const result = validateBreakdown({
      orderId: "o1",
      openDebtUsd: 90,
      rows: [
        {
          id: "b1",
          orderId: "o1",
          paymentMethod: "CASH",
          amount: 60,
          currency: "USD",
          paidAmount: 0,
          remainingAmount: 60,
        },
        {
          id: "b2",
          orderId: "o1",
          paymentMethod: "BIT",
          amount: 30,
          currency: "USD",
          paidAmount: 0,
          remainingAmount: 30,
        },
      ],
    });
    assert.equal(result.ok, true);
  });
});
