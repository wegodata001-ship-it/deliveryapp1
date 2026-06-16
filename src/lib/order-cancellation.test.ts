import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectedInternalBalanceAfterOrderCancel,
  orderCancellationReversalInternalUsd,
} from "@/lib/order-cancellation-math";
import { OS } from "@/lib/order-status-slugs";

describe("orderCancellationReversalInternalUsd", () => {
  it("regular order — reversal equals total charge", () => {
    const amount = orderCancellationReversalInternalUsd({
      status: OS.OPEN,
      totalUsd: "800",
      amountUsd: "750",
      commissionUsd: "50",
    });
    assert.equal(amount, 800);
  });

  it("debt withdrawal — reversal reduces internal balance", () => {
    const amount = orderCancellationReversalInternalUsd({
      status: OS.DEBT_WITHDRAWAL,
      totalUsd: "300",
      debtWithdrawalUsd: "250",
    });
    assert.equal(amount, -250);
  });
});

describe("expectedInternalBalanceAfterOrderCancel", () => {
  it("matches user example: 500 + 800 = 1300", () => {
    const after = expectedInternalBalanceAfterOrderCancel(500, 800);
    assert.equal(after, 1300);
  });

  it("zero order amount leaves balance unchanged", () => {
    const after = expectedInternalBalanceAfterOrderCancel(500, 0);
    assert.equal(after, 500);
  });

  it("negative starting balance still adds order amount", () => {
    const after = expectedInternalBalanceAfterOrderCancel(-200, 800);
    assert.equal(after, 600);
  });
});
