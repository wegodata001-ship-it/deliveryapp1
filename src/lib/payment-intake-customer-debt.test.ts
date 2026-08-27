import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePaymentIntakeApplyUsd,
  isExistingPaymentUnchanged,
  paymentIntakeCustomerOpenDebtUsd,
  paymentIntakeDebtAfterPaymentUsd,
  paymentIntakeDebtBeforePaymentUsd,
} from "@/lib/payment-intake-customer-debt";

describe("computePaymentIntakeApplyUsd", () => {
  it("returns full amount for new payment", () => {
    assert.equal(
      computePaymentIntakeApplyUsd({
        isExistingPayment: false,
        formTotalUsd: 4300,
        savedBaselineTotalUsd: 0,
      }),
      4300,
    );
  });

  it("returns delta zero for unchanged existing payment", () => {
    assert.equal(
      computePaymentIntakeApplyUsd({
        isExistingPayment: true,
        formTotalUsd: 4300,
        savedBaselineTotalUsd: 4300,
      }),
      0,
    );
  });

  it("returns +200 delta when existing payment increased", () => {
    assert.equal(
      computePaymentIntakeApplyUsd({
        isExistingPayment: true,
        formTotalUsd: 4500,
        savedBaselineTotalUsd: 4300,
      }),
      200,
    );
  });

  it("returns -300 delta when existing payment decreased", () => {
    assert.equal(
      computePaymentIntakeApplyUsd({
        isExistingPayment: true,
        formTotalUsd: 4000,
        savedBaselineTotalUsd: 4300,
      }),
      -300,
    );
  });
});

describe("paymentIntakeDebtAfterPaymentUsd — existing payment", () => {
  it("unchanged historical payment does not create overpayment", () => {
    assert.equal(
      paymentIntakeDebtAfterPaymentUsd({
        customerOpenDebtSignedUsd: 0,
        formPaymentUsd: 4300,
        isExistingPayment: true,
        savedBaselineTotalUsd: 4300,
      }),
      0,
    );
  });

  it("edit +200 reduces debt by delta only", () => {
    assert.equal(
      paymentIntakeDebtAfterPaymentUsd({
        customerOpenDebtSignedUsd: 500,
        formPaymentUsd: 4500,
        isExistingPayment: true,
        savedBaselineTotalUsd: 4300,
      }),
      300,
    );
  });
});

describe("paymentIntakeCustomerOpenDebtUsd", () => {
  it("returns signed open debt when positive", () => {
    assert.equal(paymentIntakeCustomerOpenDebtUsd({ customerOpenDebtSignedUsd: 4500 }), 4500);
  });

  it("returns 0 when balance reset pending", () => {
    assert.equal(
      paymentIntakeCustomerOpenDebtUsd({
        customerOpenDebtSignedUsd: 4500,
        customerBalanceResetPending: true,
      }),
      0,
    );
  });

  it("returns 0 for credit balance", () => {
    assert.equal(paymentIntakeCustomerOpenDebtUsd({ customerOpenDebtSignedUsd: -100 }), 0);
  });
});

describe("paymentIntakeDebtBeforePaymentUsd — withdrawal scenario", () => {
  it("5000 orders − 500 withdrawal = 4500 open debt", () => {
    assert.equal(
      paymentIntakeDebtBeforePaymentUsd({ customerOpenDebtSignedUsd: 4500 }),
      4500,
    );
  });
});

describe("paymentIntakeDebtAfterPaymentUsd", () => {
  it("4500 debt − 1000 payment = 3500", () => {
    assert.equal(
      paymentIntakeDebtAfterPaymentUsd({
        customerOpenDebtSignedUsd: 4500,
        formPaymentUsd: 1000,
      }),
      3500,
    );
  });

  it("4250 after multiple withdrawals and 1000 payment", () => {
    assert.equal(
      paymentIntakeDebtAfterPaymentUsd({
        customerOpenDebtSignedUsd: 4250,
        formPaymentUsd: 1000,
      }),
      3250,
    );
  });
});
