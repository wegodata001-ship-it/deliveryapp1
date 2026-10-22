import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePaymentIntakeApplyUsd,
  customerBooksAfterPaymentApply,
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

  it("customer 101: $758.01 debt − $800 payment = −$41.99 signed remaining", () => {
    assert.equal(
      paymentIntakeDebtAfterPaymentUsd({
        customerOpenDebtSignedUsd: 758.01,
        formPaymentUsd: 800,
      }),
      -41.99,
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

describe("customerBooksAfterPaymentApply", () => {
  it("Khalil: debt 0 + credit 1273.83 stays credit", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 0,
      availableCreditUsd: 1273.83,
      applyUsd: 0,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 1273.83);
  });

  it("400 debt + 500 payment to credit → debt 0 credit 100", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 400,
      availableCreditUsd: 0,
      applyUsd: 500,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 100);
  });

  it("400 debt + 500 payment to fees → debt 0 credit 0", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 400,
      availableCreditUsd: 0,
      applyUsd: 500,
      surplusToCredit: false,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 0);
  });

  it("Omar: openDebt 0 + credit 0 is not credit even if apply is 0", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 0,
      availableCreditUsd: 0,
      applyUsd: 0,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 0);
  });

  it("customer 101: nets 2031.84 − 1273.83 then applies $100 → 658.01 / 0", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 2031.84,
      availableCreditUsd: 1273.83,
      applyUsd: 100,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 658.01);
    assert.equal(books.availableCreditUsd, 0);
  });

  it("customer 101: $1000 over net debt → 0 / 241.99", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 2031.84,
      availableCreditUsd: 1273.83,
      applyUsd: 1000,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 241.99);
  });

  it("existing credit plus new excess is added, not replaced", () => {
    const books = customerBooksAfterPaymentApply({
      openDebtUsd: 0,
      availableCreditUsd: 400,
      applyUsd: 50,
      surplusToCredit: true,
    });
    assert.equal(books.openDebtUsd, 0);
    assert.equal(books.availableCreditUsd, 450);
  });
});
