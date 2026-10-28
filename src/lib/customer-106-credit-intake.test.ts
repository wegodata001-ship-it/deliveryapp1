import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import {
  availableCreditForWeekScopedPayable,
  buildPaymentPreview,
  computePendingCreditApplyUsd,
} from "@/lib/payment-intake-preview";
import { isInternalNonReceiptPayment } from "@/lib/cash-control-internal-payments";

function preview106(input: {
  debt: number;
  credit?: number;
  payment?: number;
  useExistingCredit?: boolean;
}) {
  return buildPaymentPreview({
    financialState: {
      openDebtUsd: input.debt,
      availableCreditUsd: input.credit ?? 28.9,
      commissionBalanceUsd: 150.68,
    },
    draftPaymentUsd: input.payment ?? 0,
    useExistingCredit: input.useExistingCredit,
  });
}

describe("customer 106 credit intake", () => {
  it("TEST 1 — available credit +$28.90 is shown even with a new payable order", () => {
    assert.equal(
      availableCreditForWeekScopedPayable({
        weekScopedDebtUsd: 1000,
        ssotAvailableCreditUsd: 28.9,
      }),
      28.9,
    );
    const p = preview106({ debt: 1000 });
    assert.equal(p.existingCredit, 28.9);
    assert.equal(p.debtBefore, 1000);
    assert.equal(p.pendingCreditApplyUsd, 0);
    assert.equal(p.remainingDebt, 1000);
    assert.equal(p.projectedOverpayment, 0);
  });

  it("TEST 1 — no CURRENT debt does not hide the credit", () => {
    const p = preview106({ debt: 0 });
    assert.equal(p.existingCredit, 28.9);
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedCredit, 28.9);
  });

  it("TEST 2 — $1,000 order stays $1,000 until credit is approved", () => {
    const before = preview106({ debt: 1000, credit: 28.9 });
    assert.equal(before.debtBefore, 1000);
    assert.equal(before.existingCredit, 28.9);
    assert.equal(before.pendingCreditApplyUsd, 0);
    assert.equal(before.remainingDebt, 1000);

    const after = preview106({ debt: 1000, credit: 28.9, useExistingCredit: true });
    assert.equal(after.pendingCreditApplyUsd, 28.9);
    assert.equal(after.remainingDebt, 971.1);
    assert.equal(after.projectedCredit, 0);
  });

  it("TEST 3 — paying the full order without using credit leaves the old credit", () => {
    const p = preview106({ debt: 1000, credit: 28.9, payment: 1000 });
    assert.equal(p.pendingCreditApplyUsd, 0);
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 0);
    assert.equal(p.projectedCredit, 28.9);
    const over = computePaymentOverpayment(1000, 1000);
    assert.equal(over.hasOverpayment, false);
    assert.equal(over.overpaymentUsd, 0);
  });

  it("TEST 4 — partial $10 leaves $18.90 credit", () => {
    const apply = computePendingCreditApplyUsd({
      availableCreditUsd: 28.9,
      eligibleAmountToPayUsd: 1000,
      useExistingCredit: true,
      maxApplyUsd: 10,
    });
    assert.equal(apply, 10);
    assert.equal(Number((28.9 - apply).toFixed(2)), 18.9);
  });

  it("TEST 6 — old credit is not a new receipt in the overpayment message", () => {
    const withoutApply = preview106({ debt: 1000, credit: 28.9, payment: 0 });
    assert.equal(withoutApply.projectedOverpayment, 0);
    const fullPay = preview106({ debt: 1000, credit: 28.9, payment: 1000 });
    assert.equal(fullPay.projectedOverpayment, 0);
    const applyThenPay = preview106({
      debt: 1000,
      credit: 28.9,
      payment: 1000,
      useExistingCredit: true,
    });
    assert.equal(applyThenPay.pendingCreditApplyUsd, 28.9);
    assert.equal(applyThenPay.projectedOverpayment, 28.9);
    assert.equal(
      computePaymentOverpayment(
        applyThenPay.debtBefore - applyThenPay.pendingCreditApplyUsd,
        applyThenPay.draftPaymentTotal,
      ).overpaymentUsd,
      28.9,
    );
  });

  it("TEST 7 — CREDIT_APPLICATION is not a cash-control receipt", () => {
    assert.equal(isInternalNonReceiptPayment("CUSTOMER_CREDIT"), true);
    assert.equal(isInternalNonReceiptPayment("CREDIT_APPLICATION"), true);
    assert.equal(isInternalNonReceiptPayment("STANDARD"), false);
  });
});
