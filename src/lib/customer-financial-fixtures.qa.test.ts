import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExclusiveCustomerBooks } from "@/lib/customer-account-balances-shared";
import {
  collectibleOpenDebtAfterWithdrawalUsd,
  computeOrderOpenDebtUsd,
  virtualCustomerCreditAppliedUsdByOrderId,
} from "@/lib/order-remaining-debt";

describe("financial mechanism fixtures", () => {
  it("keeps an active credit out of another customer's debt", () => {
    const withDebt = normalizeExclusiveCustomerBooks({ openDebtUsd: 1212, availableCreditUsd: 0 });
    const withCredit = normalizeExclusiveCustomerBooks({ openDebtUsd: 0, availableCreditUsd: 28.05 });
    assert.equal(withDebt.openDebtUsd, 1212);
    assert.equal(withDebt.availableCreditUsd, 0);
    assert.equal(withCredit.openDebtUsd, 0);
    assert.equal(withCredit.availableCreditUsd, 28.05);
  });

  it("nets credit against the same customer's debt", () => {
    const books = normalizeExclusiveCustomerBooks({ openDebtUsd: 1212, availableCreditUsd: 28.05 });
    assert.equal(books.openDebtUsd, 1183.95);
    assert.equal(books.availableCreditUsd, 0);
    assert.equal(books.netBalanceUsd, -1183.95);
  });

  it("applies customer credit FIFO and leaves the unpaid remainder", () => {
    const rows = [
      { orderId: "older", remainingAfterPaymentsUsd: 1000 },
      { orderId: "newer", remainingAfterPaymentsUsd: 500 },
    ];
    const applied = virtualCustomerCreditAppliedUsdByOrderId(rows, 0, 1200);
    assert.equal(applied.get("older"), 1000);
    assert.equal(applied.get("newer"), 200);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd([1000, 500], 0, 1200), 300);
    assert.equal(computeOrderOpenDebtUsd(7362.9, 7362.9), 0);
    assert.equal(computeOrderOpenDebtUsd(7362.9, 0), 7362.9);
  });

  it("uses the proved customer 101 identity on fixed inputs", () => {
    const charges = 20048.5;
    const payments = 16653.67;
    const creditApplied = 2793.83;
    const gross = Math.round((charges - payments) * 100) / 100;
    const debt = collectibleOpenDebtAfterWithdrawalUsd([gross], 0, creditApplied);
    assert.equal(gross, 3394.83);
    assert.equal(debt, 601);
  });
});
