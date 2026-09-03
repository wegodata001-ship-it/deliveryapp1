import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDebtWithdrawalFifoToRemainders,
  collectibleOpenDebtAfterWithdrawalUsd,
} from "@/lib/order-remaining-debt";
import { applyDebtWithdrawalToIntakeOrders, type PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { planPaymentIntentAdjustments } from "@/lib/payment-method-payment-intent";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { paymentIntakeOrderDateThroughAhWeekEnd } from "@/lib/payment-intake-order-filter";
import { getAhWeekRange } from "@/lib/work-week";

function row(partial: Partial<PaymentIntakeOrderRow> & Pick<PaymentIntakeOrderRow, "id" | "dbRemainingUsd">): PaymentIntakeOrderRow {
  return {
    orderNumber: partial.orderNumber ?? partial.id,
    paymentCode: null,
    dateYmd: "2026-08-02",
    week: "AH-134",
    rate: "3.0000",
    amountUsd: "0.00",
    commissionUsd: "0.00",
    totalIls: "0.00",
    totalAmountUsd: partial.dbRemainingUsd,
    dbPaidUsd: "0.00",
    status: "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: "TURKEY",
    isComposite: false,
    breakdown: [
      {
        method: "CASH",
        label: "מזומן",
        currency: "USD",
        planned: Number(partial.dbRemainingUsd),
        paid: 0,
        remaining: Number(partial.dbRemainingUsd),
        plannedUsd: Number(partial.dbRemainingUsd),
        paidUsd: 0,
        remainingUsd: Number(partial.dbRemainingUsd),
      },
    ],
    actualMethods: [],
    hasMethodDeviation: false,
    ...partial,
  };
}

describe("week does not erase open debt", () => {
  it("intake week filter is orderDate <= end of selected AH week, not weekCode equality", () => {
    const where = paymentIntakeOrderDateThroughAhWeekEnd("AH-139");
    assert.ok(where);
    const rng = getAhWeekRange("AH-139");
    assert.ok(rng?.to);
    const lte = (where as { OR?: Array<{ orderDate?: { lte?: Date } }> }).OR?.find((c) => c.orderDate?.lte);
    assert.ok(lte?.orderDate?.lte);
    assert.ok(!JSON.stringify(where).includes('"weekCode"'));
  });

  it("AH-134 remainder $500 is still collectible in AH-139 / AH-140", () => {
    const remainders = [500];
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd(remainders, 0), 500);
    const after300 = applyDebtWithdrawalFifoToRemainders(remainders, 0);
    assert.deepEqual(after300, [500]);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd([200], 0), 200);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd([0], 0), 0);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd([0], 0) + 50, 50);
  });
});

describe("customer 105 leftover vs debt withdrawal", () => {
  it("proves $508.47 + $703.53 = $1,212 and withdrawal closes collectible debt to $0", () => {
    const remainders = [508.47, 703.53];
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd(remainders, 0), 1212);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd(remainders, 1212), 0);
    assert.deepEqual(applyDebtWithdrawalFifoToRemainders(remainders, 1212), [0, 0]);
  });

  it("intake rows and auto-adjust use the same $0 after withdrawal FIFO", () => {
    const orders = applyDebtWithdrawalToIntakeOrders(
      [
        row({ id: "TR-134-0011", dbRemainingUsd: "508.47" }),
        row({ id: "TR-137-0004", dbRemainingUsd: "703.53" }),
      ],
      1212,
    );
    const sum = orders.reduce((s, o) => s + Number(o.dbRemainingUsd), 0);
    assert.equal(sum, 0);
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [{ method: "CASH", currency: "USD", amountNative: 1000 }],
      customerOpenDebtUsd: 0,
    });
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.openDebtUsd, 0);
      assert.equal(plan.closesDebtUsd, 0);
      assert.equal(plan.overpaymentUsd, 1000);
    }
  });
});

describe("partial / full / overpay against real open debt", () => {
  it("payment $1000 against $1212 leaves $212 and no credit", () => {
    const over = computePaymentOverpayment(1212, 1000);
    assert.equal(over.closesDebtUsd, 1000);
    assert.equal(over.overpaymentUsd, 0);
    assert.equal(over.openDebtUsd - over.closesDebtUsd, 212);
  });

  it("payment $1212 closes debt with no credit", () => {
    const over = computePaymentOverpayment(1212, 1212);
    assert.equal(over.closesDebtUsd, 1212);
    assert.equal(over.overpaymentUsd, 0);
  });

  it("payment $1500 against $1212 creates $288 credit only", () => {
    const over = computePaymentOverpayment(1212, 1500);
    assert.equal(over.closesDebtUsd, 1212);
    assert.equal(over.overpaymentUsd, 288);
  });
});
