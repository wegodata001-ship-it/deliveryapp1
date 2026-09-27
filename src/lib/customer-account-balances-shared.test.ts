import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertExclusiveCustomerBooks,
  buildCustomerFinancialState,
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
  customerNetBalanceTone,
  formatCustomerNetBalanceUsd,
  matchesCustomerNetBalanceFilter,
  normalizeExclusiveCustomerBooks,
} from "@/lib/customer-account-balances-shared";
import { isCustomerDebtExcludedPayment } from "@/lib/payment-adjustment-fee";

describe("customer account SSOT — exclusive debt/credit books", () => {
  it("1003: $0 debt + $15 credit is not balanced", () => {
    const balances = { openDebtUsd: 0, availableCreditUsd: 15 };
    assert.equal(classifyCustomerAccountStatus(balances), "credit");
    assert.equal(customerAccountStatusLabel(balances), "יתרת זכות +$15.00");
    assert.equal(customerAccountSignedUsd(balances), -15);
  });

  it("does not clamp credit to 0", () => {
    assert.equal(customerAccountSignedUsd({ openDebtUsd: 0, availableCreditUsd: 15 }), -15);
  });

  it("open debt and credit net: 40 − 15 = 25 debt, credit 0", () => {
    const balances = { openDebtUsd: 40, availableCreditUsd: 15 };
    const state = buildCustomerFinancialState(balances);
    assert.equal(classifyCustomerAccountStatus(balances), "debt");
    assert.equal(customerAccountSignedUsd(balances), 25);
    assert.equal(state.openDebtUsd, 25);
    assert.equal(state.customerCreditUsd, 0);
  });

  it("zero + zero is balanced", () => {
    const balances = { openDebtUsd: 0, availableCreditUsd: 0 };
    assert.equal(classifyCustomerAccountStatus(balances), "even");
    assert.equal(customerAccountStatusLabel(balances), "מאוזן");
    assert.equal(customerAccountSignedUsd(balances), 0);
  });

  it("credit + fees stay separate — no 400-30", () => {
    const state = buildCustomerFinancialState({
      openDebtUsd: 0,
      availableCreditUsd: 400,
      commissionBalanceUsd: 30,
    });
    assert.equal(state.financialStatus, "CREDIT");
    assert.equal(state.headline, "יתרת זכות +$400.00");
    assert.equal(state.feeBalanceUsd, 30);
    assert.notEqual(state.displayAmountUsd, 370);
  });

  it("Omar leftover signed is not customer credit", () => {
    const state = buildCustomerFinancialState({ openDebtUsd: 0, availableCreditUsd: 0 });
    assert.equal(state.financialStatus, "BALANCED");
    assert.equal(state.customerCreditUsd, 0);
    assert.equal(state.headline, "$0.00");
    assert.notEqual(state.amountFormatted, "+$252.50");
  });

  it("does not represent credit as negative open debt", () => {
    const state = buildCustomerFinancialState({ openDebtUsd: 0, availableCreditUsd: 773.83 });
    assert.equal(state.openDebtUsd, 0);
    assert.equal(state.customerCreditUsd, 773.83);
    assert.equal(state.amountFormatted, "+$773.83");
  });
});

describe("exclusive debt/credit invariant", () => {
  it("customer 101: 2031.84 − 1273.83 = 758.01 debt, 0 credit", () => {
    const books = normalizeExclusiveCustomerBooks({
      openDebtUsd: 2031.84,
      availableCreditUsd: 1273.83,
    });
    assert.equal(books.openDebtUsd, 758.01);
    assert.equal(books.availableCreditUsd, 0);
    assert.equal(books.netPositionUsd, 758.01);
    assert.equal(books.netBalanceUsd, -758.01);
    assert.equal(formatCustomerNetBalanceUsd(books.netBalanceUsd), "-$758.01");
    assert.equal(customerNetBalanceTone(books.netBalanceUsd), "debt");
  });

  it("reverse: 500 debt − 800 credit = 0 debt, 300 credit", () => {
    const books = normalizeExclusiveCustomerBooks({
      openDebtUsd: 500,
      availableCreditUsd: 800,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 300);
    assert.equal(books.netPositionUsd, -300);
    assert.equal(books.netBalanceUsd, 300);
    assert.equal(formatCustomerNetBalanceUsd(books.netBalanceUsd), "+$300.00");
    assert.equal(customerNetBalanceTone(books.netBalanceUsd), "credit");
  });

  it("balanced nets to zero / zero", () => {
    const books = normalizeExclusiveCustomerBooks({
      openDebtUsd: 100,
      availableCreditUsd: 100,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 0);
    assert.equal(books.netBalanceUsd, 0);
    assert.equal(formatCustomerNetBalanceUsd(0), "$0.00");
    assert.equal(customerNetBalanceTone(0), "balanced");
  });

  it("ALL includes zero; Debt + Credit + Balanced = All", () => {
    const nets = [-758.01, 28.05, 0, 0, 15, -1];
    const all = nets.filter((n) => matchesCustomerNetBalanceFilter(n, "ALL"));
    const debt = nets.filter((n) => matchesCustomerNetBalanceFilter(n, "OWES"));
    const credit = nets.filter((n) => matchesCustomerNetBalanceFilter(n, "CREDIT"));
    const balanced = nets.filter((n) => matchesCustomerNetBalanceFilter(n, "BALANCED"));
    assert.equal(all.length, 6);
    assert.equal(debt.length + credit.length + balanced.length, all.length);
    assert.equal(matchesCustomerNetBalanceFilter(0, "ALL"), true);
  });

  it("never returns both books positive", () => {
    const samples = [
      [2031.84, 1273.83],
      [500, 800],
      [0, 15],
      [40, 15],
      [0, 0],
      [12.34, 12.34],
    ] as const;
    for (const [debt, credit] of samples) {
      const books = normalizeExclusiveCustomerBooks({
        openDebtUsd: debt,
        availableCreditUsd: credit,
      });
      assert.ok(!(books.openDebtUsd > 0.01 && books.availableCreditUsd > 0.01));
      assertExclusiveCustomerBooks(books);
    }
  });

  it("assertExclusiveCustomerBooks fails when both are positive", () => {
    assert.throws(
      () => assertExclusiveCustomerBooks({ openDebtUsd: 10, availableCreditUsd: 5 }),
      /EXCLUSIVE_BOOKS_VIOLATION/,
    );
  });
});

describe("debt-payment exclusions", () => {
  it("ADJUSTMENT_FEE is not a debt closer", () => {
    assert.equal(isCustomerDebtExcludedPayment("ADJUSTMENT_FEE"), true);
  });

  it("CUSTOMER_CREDIT is credit, not a fee or debt payment", () => {
    assert.equal(isCustomerDebtExcludedPayment("CUSTOMER_CREDIT"), true);
  });

  it("STANDARD payments still close debt", () => {
    assert.equal(isCustomerDebtExcludedPayment("STANDARD"), false);
    assert.equal(isCustomerDebtExcludedPayment("CREDIT_APPLICATION"), false);
    assert.equal(isCustomerDebtExcludedPayment("BALANCE_RESET"), false);
  });
});
