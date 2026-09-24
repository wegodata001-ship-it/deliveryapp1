import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerAccountSignedUsd } from "@/lib/customer-account-balances-shared";
import {
  customerActualPaymentsReceivedUsd,
  customerExpectedSignedBalanceUsd,
  reconcileCustomerBalanceRow,
  sumCustomerBalanceReconciliations,
} from "@/lib/customer-balances-reconciliation";

function assertIdentity(input: {
  afterFeesUsd: number;
  withdrawalsUsd?: number;
  debtPaymentsUsd: number;
  availableCreditUsd: number;
  expectedBalanceUsd: number;
}) {
  const row = reconcileCustomerBalanceRow(input);
  assert.equal(row.actualPaymentsUsd, customerActualPaymentsReceivedUsd(input));
  assert.equal(row.expectedBalanceUsd, input.expectedBalanceUsd);
  assert.equal(
    customerExpectedSignedBalanceUsd({
      afterFeesUsd: row.afterFeesUsd,
      withdrawalsUsd: row.withdrawalsUsd,
      actualPaymentsUsd: row.actualPaymentsUsd,
    }),
    input.expectedBalanceUsd,
  );
  assert.equal(row.formulaDifferenceUsd, 0);
}

describe("customer balances KPI reconciliation", () => {
  it("CASE A — exact payment", () => {
    assertIdentity({
      afterFeesUsd: 30_000,
      debtPaymentsUsd: 30_000,
      availableCreditUsd: 0,
      expectedBalanceUsd: 0,
    });
  });

  it("CASE 101 — open debt keeps credit on a separate book", () => {
    const row = reconcileCustomerBalanceRow({
      afterFeesUsd: 17_927.5,
      debtPaymentsUsd: 15_895.66,
      availableCreditUsd: 1_273.83,
      openDebtUsd: 2_031.84,
    });
    assert.equal(row.actualPaymentsUsd, 15_895.66);
    assert.equal(row.expectedBalanceUsd, 2_031.84);
    assert.equal(customerAccountSignedUsd({ openDebtUsd: 2_031.84, availableCreditUsd: 1_273.83 }), 2_031.84);
  });

  it("CASE B — overpayment stays in payments, not clamped to debt", () => {
    const row = reconcileCustomerBalanceRow({
      afterFeesUsd: 30_000,
      debtPaymentsUsd: 30_000,
      availableCreditUsd: 1_300,
    });
    assert.equal(row.actualPaymentsUsd, 31_300);
    assert.equal(row.expectedBalanceUsd, -1_300);
    assert.notEqual(row.actualPaymentsUsd, 30_000);
    assert.equal(customerAccountSignedUsd({ openDebtUsd: 0, availableCreditUsd: 1_300 }), -1_300);
  });

  it("CASE C — open debt", () => {
    assertIdentity({
      afterFeesUsd: 30_000,
      debtPaymentsUsd: 27_500,
      availableCreditUsd: 0,
      expectedBalanceUsd: 2_500,
    });
  });

  it("CASE D — mixed customers net credit and debt", () => {
    const a = reconcileCustomerBalanceRow({
      afterFeesUsd: 10_000,
      debtPaymentsUsd: 10_000,
      availableCreditUsd: 2_000,
    });
    const b = reconcileCustomerBalanceRow({
      afterFeesUsd: 20_000,
      debtPaymentsUsd: 18_500,
      availableCreditUsd: 0,
    });
    assert.equal(a.expectedBalanceUsd, -2_000);
    assert.equal(b.expectedBalanceUsd, 1_500);
    const total = sumCustomerBalanceReconciliations([a, b]);
    assert.equal(total.afterFeesUsd, 30_000);
    assert.equal(total.actualPaymentsUsd, 30_500);
    assert.equal(total.expectedBalanceUsd, -500);
    assert.equal(total.formulaDifferenceUsd, 0);
  });

  it("CASE E — large overpayment cents", () => {
    assertIdentity({
      afterFeesUsd: 43_905,
      debtPaymentsUsd: 43_905,
      availableCreditUsd: 1_562.21,
      expectedBalanceUsd: -1_562.21,
    });
  });

  it("does not put fees into payments or balance", () => {
    const row = reconcileCustomerBalanceRow({
      afterFeesUsd: 1_000,
      debtPaymentsUsd: 1_000,
      availableCreditUsd: 0,
    });
    assert.equal(row.expectedBalanceUsd, 0);
    assert.equal(row.actualPaymentsUsd, 1_000);
  });

  it("withdrawals stay a separate term — not hidden inside payments", () => {
    const row = reconcileCustomerBalanceRow({
      afterFeesUsd: 1_000,
      withdrawalsUsd: 200,
      debtPaymentsUsd: 500,
      availableCreditUsd: 0,
    });
    assert.equal(row.actualPaymentsUsd, 500);
    assert.equal(row.expectedBalanceUsd, 300);
  });

  it("section 10 — net KPI is debt minus credit across customers", () => {
    const total = sumCustomerBalanceReconciliations([
      reconcileCustomerBalanceRow({
        afterFeesUsd: 2_000,
        debtPaymentsUsd: 0,
        availableCreditUsd: 0,
      }),
      reconcileCustomerBalanceRow({
        afterFeesUsd: 0,
        debtPaymentsUsd: 0,
        availableCreditUsd: 1_300,
      }),
    ]);
    assert.equal(total.expectedBalanceUsd, 700);
  });
});
