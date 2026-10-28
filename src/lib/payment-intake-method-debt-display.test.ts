import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  distributeOrderDebtPaidToMethods,
  orderBreakdownPaidDriftUsd,
  sumUniqueOrderBreakdownCommissionDrift,
} from "@/lib/payment-intake-method-debt-display";

describe("payment-intake-method-debt-display", () => {
  it("distributes order debt paid across methods by planned weight", () => {
    const native = distributeOrderDebtPaidToMethods(5594.17, [
      { plannedUsd: 2972.21, paidBreakdownUsd: 2972.21, currency: "USD", plannedNative: 2972.21 },
      { plannedUsd: 3895.79, paidBreakdownUsd: 2663.95, currency: "USD", plannedNative: 3895.79 },
    ]);
    const sum = Math.round(native.reduce((s, n) => s + n, 0) * 100) / 100;
    assert.equal(sum, 5594.17);
  });

  it("detects PMC commission drift per order", () => {
    assert.equal(orderBreakdownPaidDriftUsd(5594.17, 5636.16), 41.99);
    const drift = sumUniqueOrderBreakdownCommissionDrift([
      { orderId: "o1", paidBreakdownUsd: 2972.21, orderDebtPaidUsd: 2972.21 },
      { orderId: "o1", paidBreakdownUsd: 2663.95, orderDebtPaidUsd: 5594.17 },
    ]);
    assert.equal(drift, 41.99);
  });
});
