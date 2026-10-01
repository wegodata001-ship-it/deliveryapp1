import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availableCreditForWeekScopedPayable,
  buildPaymentPreview,
  computePendingCreditApplyUsd,
  remainingToPayCardDisplayFromOverpayment,
  remainingToPayCardDisplayFromPreview,
  toPaymentPreviewOrders,
} from "@/lib/payment-intake-preview";
import { formatPaymentBalanceUsdLine } from "@/lib/order-remaining-debt";

function preview(input: {
  debt: number | null;
  credit?: number;
  fees?: number;
  payment?: number;
  useExistingCredit?: boolean;
  selectedRemaining?: number;
}) {
  return buildPaymentPreview({
    financialState: {
      openDebtUsd: input.debt,
      availableCreditUsd: input.credit ?? 0,
      commissionBalanceUsd: input.fees ?? 0,
    },
    draftPaymentUsd: input.payment ?? 0,
    selectedOrdersRemainingUsd: input.selectedRemaining,
    useExistingCredit: input.useExistingCredit,
  });
}

describe("buildPaymentPreview", () => {
  it("CASE 1 — debt 1000, credit 0, payment 0 → remaining 1000", () => {
    const p = preview({ debt: 1000 });
    assert.equal(p.remainingDebt, 1000);
    assert.equal(p.projectedOverpayment, 0);
  });

  it("CASE 2 — debt 1000, payment 100 → remaining 900", () => {
    const p = preview({ debt: 1000, payment: 100 });
    assert.equal(p.remainingDebt, 900);
    assert.equal(p.draftPaymentTotal, 100);
  });

  it("CASE 3 — exclusive net then payment: 1000 − 200 − 100 = 700", () => {
    const p = preview({ debt: 1000, credit: 200, payment: 100, useExistingCredit: true });
    assert.equal(p.debtBefore, 800);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 700);
  });

  it("CASE 3 — credit always nets at SSOT, flag does not keep both books", () => {
    const p = preview({ debt: 1000, credit: 200, payment: 100, useExistingCredit: false });
    assert.equal(p.debtBefore, 800);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 700);
  });

  it("CASE 4 — overpayment: remaining 0, projected credit 50", () => {
    const p = preview({ debt: 100, payment: 150 });
    assert.equal(p.signedRemainingUsd, -50);
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 50);
    assert.equal(p.projectedCredit, 50);
  });

  it("CASE 5 — credit only, no payment → remaining 0", () => {
    const p = preview({ debt: 0, credit: 100 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedCredit, 100);
  });

  it("CASE 6 — credit + payment does not create debt", () => {
    const p = preview({ debt: 0, credit: 100, payment: 50 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 50);
    assert.equal(p.projectedCredit, 150);
  });

  it("CASE 7 — fees without debt stay out of remaining", () => {
    const p = preview({ debt: 0, fees: 177.5 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.fees, 177.5);
  });

  it("does not treat unloaded SSOT as $0 when orders have remaining", () => {
    const p = preview({ debt: null, selectedRemaining: 1112, payment: 0 });
    assert.equal(p.remainingDebt, 1112);
    assert.equal(p.debtBefore, 1112);
    assert.equal(p.selectedOrdersRemaining, 1112);
  });

  it("week-scoped remaining wins over CURRENT SSOT (AH-134 vs AH-140 debt)", () => {
    const p = preview({ debt: 758.01, selectedRemaining: 0, payment: 100 });
    assert.equal(p.debtBefore, 0);
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 100);
    assert.equal(p.selectedOrdersRemaining, 0);
  });

  it("AH-140 week remaining $758.01 is the payable, not a second CURRENT source", () => {
    const p = preview({ debt: 758.01, selectedRemaining: 758.01, payment: 0 });
    assert.equal(p.debtBefore, 758.01);
    assert.equal(p.remainingDebt, 758.01);
  });

  it("customer 101: 2031.84 − 1273.83 = 758.01 remaining, credit 0", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83 });
    assert.equal(p.debtBefore, 758.01);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.remainingDebt, 758.01);
  });

  it("customer 101 + $100 → remaining 658.01", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83, payment: 100 });
    assert.equal(p.remainingDebt, 658.01);
    assert.equal(p.projectedCredit, 0);
  });

  it("customer 101 + $1000 → debt 0, credit 241.99", () => {
    const p = preview({ debt: 2031.84, credit: 1273.83, payment: 1000 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedCredit, 241.99);
  });

  it("reverse books: 500 debt + 800 credit → remaining 0, credit 300", () => {
    const p = preview({ debt: 500, credit: 800 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.existingCredit, 300);
    assert.equal(p.projectedCredit, 300);
  });

  it("never returns negative remainingDebt; signed remaining keeps the overpayment", () => {
    const p = preview({ debt: 80, payment: 100 });
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.signedRemainingUsd, -20);
    assert.ok(p.projectedOverpayment > 0);
  });

  it("customer 101: $758.01 debt + $800 payment → signed −$41.99 preview credit", () => {
    const p = preview({ debt: 758.01, payment: 800 });
    assert.equal(p.debtBefore, 758.01);
    assert.equal(p.draftPaymentTotal, 800);
    assert.equal(p.signedRemainingUsd, -41.99);
    assert.equal(p.remainingDebt, 0);
    assert.equal(p.projectedOverpayment, 41.99);
    assert.equal(p.existingCredit, 0);
    assert.equal(p.projectedCredit, 41.99);
  });

  it("week-scoped payable never shows gross $1,273.83 as available credit", () => {
    assert.equal(
      availableCreditForWeekScopedPayable({
        weekScopedDebtUsd: 758.01,
        ssotAvailableCreditUsd: 0,
      }),
      0,
    );
    assert.equal(
      availableCreditForWeekScopedPayable({
        weekScopedDebtUsd: 758.01,
        ssotAvailableCreditUsd: 1273.83,
      }),
      0,
    );
    assert.equal(
      availableCreditForWeekScopedPayable({
        weekScopedDebtUsd: 0,
        ssotAvailableCreditUsd: 41.99,
      }),
      41.99,
    );
  });

  it("customer 101 exclusive books: available credit $0 so overpay credit is $41.99 not $1,315.82", () => {
    const p = preview({ debt: 758.01, credit: 0, payment: 800 });
    assert.equal(p.existingCredit, 0);
    assert.equal(p.projectedCredit, 41.99);
    assert.notEqual(p.projectedCredit, 1315.82);
  });

  it("remaining card never uses clamped $0 when overpayment is $41.99", () => {
    const clampedZero = {
      state: "cleared" as const,
      title: "נשאר לתשלום",
      statusHint: "אין יתרה פתוחה",
      balanceUsdSigned: 0,
      displayUsd: 0,
      displayIls: 0,
    };
    const d = remainingToPayCardDisplayFromOverpayment(41.99, clampedZero, 3);
    assert.equal(d.state, "surplus");
    assert.equal(d.displayUsd, 41.99);
    assert.equal(formatPaymentBalanceUsdLine(d), "+$41.99");
    assert.equal(d.statusHint, "תשלום יתר");
    assert.notEqual(formatPaymentBalanceUsdLine(d), "$0.00");
  });

  it("remaining card cases for customer 101 preview", () => {
    const rate = 3;
    const cases = [
      { payment: 700, value: "$58.01", hint: "יתרה פתוחה" },
      { payment: 758.01, value: "$0.00", hint: "אין יתרה פתוחה" },
      { payment: 760, value: "+$1.99", hint: "תשלום יתר" },
      { payment: 800, value: "+$41.99", hint: "תשלום יתר" },
    ] as const;
    for (const row of cases) {
      const p = preview({ debt: 758.01, payment: row.payment });
      const d = remainingToPayCardDisplayFromPreview(p, rate);
      assert.equal(formatPaymentBalanceUsdLine(d), row.value, `pay ${row.payment}`);
      assert.equal(d.statusHint, row.hint, `hint ${row.payment}`);
    }
    const fifty = remainingToPayCardDisplayFromPreview(preview({ debt: 750, payment: 800 }), rate);
    assert.equal(formatPaymentBalanceUsdLine(fifty), "+$50.00");
    assert.equal(fifty.statusHint, "תשלום יתר");
  });

  it("customer 101: $758.01 debt + $500 payment → signed +$258.01 debt remaining", () => {
    const p = preview({ debt: 758.01, payment: 500 });
    assert.equal(p.signedRemainingUsd, 258.01);
    assert.equal(p.remainingDebt, 258.01);
    assert.equal(p.projectedOverpayment, 0);
  });
});

describe("computePendingCreditApplyUsd", () => {
  it("customer 107: credit $28.05 and no eligible remaining → $0", () => {
    assert.equal(
      computePendingCreditApplyUsd({
        availableCreditUsd: 28.05,
        eligibleAmountToPayUsd: 0,
        useExistingCredit: true,
      }),
      0,
    );
  });

  it("caps apply to eligible amount", () => {
    assert.equal(
      computePendingCreditApplyUsd({
        availableCreditUsd: 28.05,
        eligibleAmountToPayUsd: 10,
        useExistingCredit: true,
      }),
      10,
    );
    assert.equal(
      computePendingCreditApplyUsd({
        availableCreditUsd: 28.05,
        eligibleAmountToPayUsd: 100,
        useExistingCredit: true,
      }),
      28.05,
    );
  });

  it("does not apply until the user opts in", () => {
    assert.equal(
      computePendingCreditApplyUsd({
        availableCreditUsd: 28.05,
        eligibleAmountToPayUsd: 100,
        useExistingCredit: false,
      }),
      0,
    );
  });
});

describe("toPaymentPreviewOrders", () => {
  it("converts intake string money to finite numbers and rejects invalid", () => {
    const previewOrders = toPaymentPreviewOrders([
      {
        totalAmountUsd: "758.01",
        amountUsd: "700",
        commissionUsd: "58.01",
        dbPaidUsd: "0",
        dbRemainingUsd: "758.01",
        status: "unpaid",
      },
      {
        totalAmountUsd: "invalid",
        dbPaidUsd: "",
        dbRemainingUsd: "not-a-number",
        status: "paid",
      },
    ]);
    assert.equal(previewOrders[0]?.totalAmountUsd, 758.01);
    assert.equal(previewOrders[0]?.collectibleRemainingUsd, 758.01);
    assert.equal(previewOrders[1]?.totalAmountUsd, 0);
    assert.equal(previewOrders[1]?.dbPaidUsd, 0);
    assert.equal(previewOrders[1]?.collectibleRemainingUsd, 0);
    assert.ok(previewOrders.every((o) => Number.isFinite(o.totalAmountUsd ?? 0)));
  });
});
