import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCustomerAccountStatus,
  customerAccountSignedUsd,
  customerAccountStatusLabel,
} from "@/lib/customer-account-balances-shared";
import { isCustomerDebtExcludedPayment } from "@/lib/payment-adjustment-fee";

describe("customer account SSOT — three separate books", () => {
  it("1003: $0 debt + $15 credit is not balanced", () => {
    const balances = { openDebtUsd: 0, availableCreditUsd: 15 };
    assert.equal(classifyCustomerAccountStatus(balances), "credit");
    assert.equal(customerAccountStatusLabel(balances), "יתרת זכות $15.00");
    assert.equal(customerAccountSignedUsd(balances), -15);
  });

  it("does not clamp credit to 0", () => {
    assert.equal(customerAccountSignedUsd({ openDebtUsd: 0, availableCreditUsd: 15 }), -15);
  });

  it("open debt stays on the debt book", () => {
    const balances = { openDebtUsd: 40, availableCreditUsd: 15 };
    assert.equal(classifyCustomerAccountStatus(balances), "debt");
    assert.equal(customerAccountSignedUsd(balances), 40);
  });

  it("zero + zero is balanced", () => {
    const balances = { openDebtUsd: 0, availableCreditUsd: 0 };
    assert.equal(classifyCustomerAccountStatus(balances), "even");
    assert.equal(customerAccountStatusLabel(balances), "מאוזן");
    assert.equal(customerAccountSignedUsd(balances), 0);
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
