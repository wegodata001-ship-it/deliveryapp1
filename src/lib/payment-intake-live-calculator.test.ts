import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentIntakeLiveTotals } from "@/lib/payment-intake-live-calculator";

describe("computePaymentIntakeLiveTotals — משיכה מחוב SSOT", () => {
  it("כולל משיכה מחוב בסיכום ומתאים יתרה לכרטסת", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [{ id: "o1", amountUsd: 1000, commissionUsd: 50 }],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 200,
      formPaymentUsd: 0,
      customerSignedOpenDebtUsd: 1000 + 50 - 200 - 252.5,
      customerTotalChargesUsd: 1000,
      customerTotalPaymentsUsd: 200,
      customerTotalWithdrawalsUsd: 252.5,
      customerApplyPaymentUsd: 0,
    });
    assert.equal(totals.chargesUsd, 1000);
    assert.equal(totals.paymentsUsd, 200);
    assert.equal(totals.withdrawalsUsd, 252.5);
    assert.equal(totals.balanceUsd, 597.5);
  });

  it("לא מאבד משיכה גם כשרשימת הזמנות בקליטה ריקה ממשיכות", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [{ id: "regular", amountUsd: 500, commissionUsd: 0 }],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 0,
      formPaymentUsd: 0,
      customerSignedOpenDebtUsd: 500 - 252.5,
      customerTotalChargesUsd: 500,
      customerTotalPaymentsUsd: 0,
      customerTotalWithdrawalsUsd: 252.5,
    });
    assert.equal(totals.withdrawalsUsd, 252.5);
    assert.equal(totals.balanceUsd, 247.5);
  });

  it("fallback בלי SSOT — withdrawals=0 (תאימות לאחור)", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [{ id: "o1", amountUsd: 100, commissionUsd: 10 }],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 40,
      formPaymentUsd: 0,
    });
    assert.equal(totals.withdrawalsUsd, 0);
    assert.equal(totals.chargesUsd, 100);
    assert.equal(totals.balanceUsd, 70);
  });

  it("null SSOT ≠ 0 — לא מציג מאוזן לפני טעינה כשיש הזמנות", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [
        { id: "a", amountUsd: 21055, commissionUsd: 210.55 },
        { id: "b", amountUsd: 1600, commissionUsd: 16 },
      ],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 0,
      formPaymentUsd: 0,
      customerSignedOpenDebtUsd: null,
      customerTotalChargesUsd: null,
      customerTotalPaymentsUsd: null,
      customerTotalWithdrawalsUsd: null,
    });
    assert.equal(totals.chargesUsd, 22655);
    assert.equal(totals.commissionsUsd, 226.55);
    assert.equal(totals.balanceUsd, 22881.55);
    assert.equal(totals.hasDebt, true);
  });

  it("SSOT טעון עם 0 חוב — מאוזן באמת (לקוח 102 אחרי כיסוי)", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [{ id: "o1", amountUsd: 4240, commissionUsd: 42.4 }],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 0,
      formPaymentUsd: 0,
      customerSignedOpenDebtUsd: -252.5,
      customerTotalChargesUsd: 4240,
      customerTotalPaymentsUsd: 4282.4,
      customerTotalWithdrawalsUsd: 252.5,
      customerApplyPaymentUsd: 0,
    });
    assert.equal(totals.withdrawalsUsd, 252.5);
    assert.equal(totals.paymentsUsd, 4282.4);
    assert.equal(totals.balanceUsd, 0);
    assert.equal(totals.hasDebt, false);
  });

  it("תשלום בטופס מתווסף מעל SSOT payments בלי לספור משיכה פעמיים", () => {
    const totals = computePaymentIntakeLiveTotals({
      orders: [],
      commissionResetOrderIds: [],
      customerPaymentsUsd: 0,
      formPaymentUsd: 100,
      customerSignedOpenDebtUsd: 597.5,
      customerTotalChargesUsd: 1050,
      customerTotalPaymentsUsd: 200,
      customerTotalWithdrawalsUsd: 252.5,
      customerApplyPaymentUsd: 100,
    });
    assert.equal(totals.paymentsUsd, 300);
    assert.equal(totals.withdrawalsUsd, 252.5);
    assert.equal(totals.balanceUsd, 497.5);
  });
});
