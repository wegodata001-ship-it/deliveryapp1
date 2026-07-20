import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDualCurrencyMatching,
  applyPaymentMethodMatching,
  type MethodBalanceRow,
} from "./matching-engine";

function bal(
  partial: Omit<MethodBalanceRow, "status" | "label"> & {
    label?: string;
    status?: MethodBalanceRow["status"];
  },
): MethodBalanceRow {
  return {
    label: partial.label ?? partial.method,
    status: partial.status ?? "open",
    ...partial,
  };
}

describe("finance-data Matching Engine — currency isolation", () => {
  it("USD only — cash $2000 clears in USD", () => {
    const result = applyPaymentMethodMatching({
      currency: "USD",
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 2000,
          paid: 0,
          remaining: 2000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    const cash = result.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!;
    assert.equal(cash.paid, 2000);
    assert.equal(cash.remaining, 0);
    assert.equal(result.surplus, 0);
  });

  it("ILS only — bank ₪10000 clears; USD entry ignored", () => {
    const result = applyPaymentMethodMatching({
      currency: "ILS",
      balances: [
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 10000,
          paid: 0,
          remaining: 10000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    const bank = result.balances.find((b) => b.currency === "ILS")!;
    assert.equal(bank.paid, 10000);
    assert.equal(bank.remaining, 0);
    assert.equal(result.surplus, 0);
  });

  it("dual currency — no cross offset", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 2000,
          paid: 0,
          remaining: 2000,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 10000,
          paid: 0,
          remaining: 10000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3.5]]),
    });

    assert.equal(dual.balances.find((b) => b.currency === "USD")!.remaining, 0);
    assert.equal(dual.balances.find((b) => b.currency === "ILS")!.remaining, 0);
    assert.equal(dual.surplusUsd, 0);
    assert.equal(dual.surplusIls, 0);
  });

  it("USD surplus does not touch ILS", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 500,
          paid: 0,
          remaining: 500,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 130 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 500 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    assert.equal(dual.surplusUsd, 30);
    assert.equal(dual.surplusIls, 0);
  });

  it("debt transfer USD→ILS currency field stays USD-scoped (ILS untouched)", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 400,
          paid: 0,
          remaining: 400,
        }),
      ],
      enteredByBucket: [],
      orderIdsOldestFirst: ["o1"],
      debtTransfers: [
        {
          fromBucket: "CASH",
          toBucket: "BANK_TRANSFER",
          amount: 100,
          currency: "USD",
        },
      ],
    });
    assert.equal(dual.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!.remaining, 0);
    assert.equal(dual.balances.find((b) => b.currency === "ILS")!.remaining, 400);
    assert.ok(dual.transfersApplied.every((t) => t.currency === "USD"));
  });
});
