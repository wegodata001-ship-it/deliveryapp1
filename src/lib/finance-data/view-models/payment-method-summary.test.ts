import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePaymentMethodLines } from "./payment-method-summary";

describe("summarizePaymentMethodLines", () => {
  it("groups by method × currency from the same row list", () => {
    const result = summarizePaymentMethodLines([
      {
        paymentMethod: "CASH",
        label: "מזומן",
        currency: "USD",
        planned: 1000,
        paid: 800,
        remaining: 200,
      },
      {
        paymentMethod: "CASH",
        label: "מזומן",
        currency: "USD",
        planned: 100,
        paid: 0,
        remaining: 100,
      },
      {
        paymentMethod: "BANK_TRANSFER",
        label: "העברה בנקאית",
        currency: "USD",
        planned: 762.5,
        paid: 500,
        remaining: 262.5,
      },
      {
        paymentMethod: "CREDIT",
        label: "אשראי",
        currency: "ILS",
        planned: 350,
        paid: 100,
        remaining: 250,
      },
    ]);

    assert.equal(result.byMethod.length, 3);
    const cash = result.byMethod.find((r) => r.paymentMethod === "CASH" && r.currency === "USD")!;
    assert.equal(cash.planned, 1100);
    assert.equal(cash.paid, 800);
    assert.equal(cash.remaining, 300);
    assert.equal(result.totals.plannedUsd, 1862.5);
    assert.equal(result.totals.paidUsd, 1300);
    assert.equal(result.totals.remainingUsd, 562.5);
    assert.equal(result.totals.plannedIls, 350);
    assert.equal(result.totals.paidIls, 100);
    assert.equal(result.totals.remainingIls, 250);
  });
});
