import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCOUNT_RESET_CONFLICT_MESSAGE,
  ACCOUNT_RESET_CREDIT_LEDGER_LABEL,
  ACCOUNT_RESET_DEBT_LEDGER_LABEL,
  ACCOUNT_RESET_EMPTY_MESSAGE,
  CREDIT_TO_COMMISSION_USER_CHOICE,
  accountResetCommissionActionLabel,
  planCustomerAccountReset,
} from "@/lib/customer-account-reset";

describe("planCustomerAccountReset", () => {
  it("TEST 1 — debt smaller than fees: $20 / $100 → debt $0 fees $80", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 20,
      availableCreditUsd: 0,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "DEBT");
    assert.equal(plan.amountToResetUsd, 20);
    assert.equal(plan.openDebtAfterUsd, 0);
    assert.equal(plan.commissionAfterUsd, 80);
    assert.equal(plan.ledgerLabel, ACCOUNT_RESET_DEBT_LEDGER_LABEL);
  });

  it("TEST 2 — debt equals fees: $100 / $100 → both $0", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 100,
      availableCreditUsd: 0,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "DEBT");
    assert.equal(plan.openDebtAfterUsd, 0);
    assert.equal(plan.commissionAfterUsd, 0);
  });

  it("TEST 3 — debt larger than fees: $120 / $100 → debt $0 fees -$20", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 120,
      availableCreditUsd: 0,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "DEBT");
    assert.equal(plan.openDebtAfterUsd, 0);
    assert.equal(plan.commissionAfterUsd, -20);
  });

  it("TEST 4 — credit to fees: $25 credit / $100 fees → credit $0 fees $125", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 0,
      availableCreditUsd: 25,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "CREDIT");
    assert.equal(plan.creditAfterUsd, 0);
    assert.equal(plan.commissionAfterUsd, 125);
    assert.equal(plan.ledgerLabel, ACCOUNT_RESET_CREDIT_LEDGER_LABEL);
  });

  it("TEST 5 — nothing to reset", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 0,
      availableCreditUsd: 0,
      commissionBalanceUsd: 40,
    });
    assert.equal(plan.kind, "NONE");
    assert.equal(plan.amountToResetUsd, 0);
    assert.equal(plan.commissionAfterUsd, 40);
    assert.equal(plan.message, ACCOUNT_RESET_EMPTY_MESSAGE);
  });

  it("does not hide a data conflict behind an arbitrary side", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: 20,
      availableCreditUsd: 25,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "CONFLICT");
    assert.equal(plan.amountToResetUsd, 0);
    assert.equal(plan.openDebtAfterUsd, 20);
    assert.equal(plan.creditAfterUsd, 25);
    assert.equal(plan.commissionAfterUsd, 100);
    assert.equal(plan.message, ACCOUNT_RESET_CONFLICT_MESSAGE);
  });

  it("never treats negative debt as credit", () => {
    const plan = planCustomerAccountReset({
      openDebtUsd: -25,
      availableCreditUsd: 25,
      commissionBalanceUsd: 100,
    });
    assert.equal(plan.kind, "CREDIT");
    assert.equal(plan.amountToResetUsd, 25);
    assert.equal(plan.commissionAfterUsd, 125);
  });
});

describe("accountResetCommissionActionLabel", () => {
  it("TEST 7 — commission detail labels", () => {
    assert.equal(accountResetCommissionActionLabel("commission_pool_debit"), "איפוס חוב");
    assert.equal(accountResetCommissionActionLabel(CREDIT_TO_COMMISSION_USER_CHOICE), "איפוס יתרת זכות");
    assert.equal(accountResetCommissionActionLabel("commission"), null);
  });
});
