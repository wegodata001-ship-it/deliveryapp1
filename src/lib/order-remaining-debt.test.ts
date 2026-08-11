import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIntakeOrderViews } from "@/lib/payment-intake-order-analysis";
import { derivePaymentIntakePlanningViews } from "@/lib/payment-intake-planning-views";
import { matchPaymentToOrders, toPaymentIntakeBases, type PaymentIntakeOrderRow } from "@/lib/payment-intake";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import {
  computeOrderOpenDebtSignedUsd,
  computeOrderOpenDebtUsd,
  computeOrderLedgerView,
  deriveOrderPaymentDisplayStatus,
  reconcileOrderBreakdownWithLedger,
  sumRemainingToPayUsd,
} from "@/lib/order-remaining-debt";

const EMPTY_KPIS: LivePaymentFormKpis = {
  cash: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  bankTransfer: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  credit: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  checks: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  other: { enteredUsd: 0, enteredIls: 0, totalUsd: 0 },
  totalPaymentUsd: 0,
};

function sampleOrder(overrides: Partial<PaymentIntakeOrderRow> = {}): PaymentIntakeOrderRow {
  return {
    id: "o1",
    orderNumber: "1001",
    paymentCode: null,
    dateYmd: "01/01/2026",
    week: "AH-1",
    rate: "3.50",
    amountUsd: "100.00",
    commissionUsd: "3.45",
    totalIls: "362.08",
    totalAmountUsd: "103.45",
    dbPaidUsd: "50.00",
    dbRemainingUsd: "53.45",
    status: "partial",
    lastPaymentDateYmd: null,
    sourceCountry: "TURKEY",
    isComposite: true,
    breakdown: [
      {
        method: "CASH",
        label: "מזומן",
        currency: "USD",
        planned: 60,
        paid: 30,
        remaining: 25,
        plannedUsd: 60,
        paidUsd: 30,
        remainingUsd: 25,
      },
      {
        method: "BANK_TRANSFER",
        label: "העברה",
        currency: "USD",
        planned: 43.45,
        paid: 20,
        remaining: 20,
        plannedUsd: 43.45,
        paidUsd: 20,
        remainingUsd: 20,
      },
    ],
    actualMethods: [],
    hasMethodDeviation: false,
    ...overrides,
  };
}

describe("order-remaining-debt SSOT", () => {
  it("computeOrderOpenDebtUsd = total − paid", () => {
    assert.equal(computeOrderOpenDebtSignedUsd(103.45, 50), 53.45);
    assert.equal(computeOrderOpenDebtUsd(103.45, 50), 53.45);
  });

  it("deriveOrderPaymentDisplayStatus matches ledger", () => {
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 100, paidUsd: 0 }), "unpaid");
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 100, paidUsd: 50 }), "partial");
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 100, paidUsd: 100 }), "paid");
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 100, paidUsd: 99.99 }), "paid");
  });

  it("computeOrderLedgerView resolves total from amount + commission", () => {
    const view = computeOrderLedgerView({
      orderId: "o1",
      amountUsd: 100,
      commissionUsd: 3.45,
      paidUsd: 50,
    });
    assert.equal(view.totalUsd, 103.45);
    assert.equal(view.remainingUsd, 53.45);
    assert.equal(view.paymentStatus, "partial");
  });

  it("full payment closes debt to zero", () => {
    assert.equal(computeOrderOpenDebtUsd(103.45, 103.45), 0);
    assert.equal(
      deriveOrderPaymentDisplayStatus({ totalUsd: 103.45, paidUsd: 103.45 }),
      "paid",
    );
  });

  it("deleted payment restores open debt", () => {
    assert.equal(computeOrderOpenDebtUsd(103.45, 0), 103.45);
    assert.equal(computeOrderOpenDebtUsd(103.45, 50), 53.45);
  });

  it("reconcile breakdown USD remaining to ledger open debt", () => {
    const order = sampleOrder();
    const fixed = reconcileOrderBreakdownWithLedger(order.breakdown, 53.45);
    const sumUsd = fixed.reduce((s, r) => s + (r.remaining ?? 0), 0);
    assert.equal(sumUsd, 53.45);
  });

  it("intake card and PMC share orderRemainingToPayUsd", () => {
    const orders = [sampleOrder()];
    const bases = toPaymentIntakeBases(orders);
    const matched = matchPaymentToOrders(bases, 0, null);
    const fromMatched = sumRemainingToPayUsd(matched);
    const views = derivePaymentIntakePlanningViews(orders, null, EMPTY_KPIS, 0);
    assert.equal(views.orderRemainingToPayUsd, fromMatched);
    assert.equal(views.orderRemainingToPayUsd, 53.45);
  });

  it("partial form payment reduces remaining equally on both paths", () => {
    const orders = [sampleOrder()];
    const bases = toPaymentIntakeBases(orders);
    const matched = matchPaymentToOrders(bases, 20, null);
    const fromMatched = sumRemainingToPayUsd(matched);
    const orderViews = buildIntakeOrderViews(orders, null, EMPTY_KPIS, 20);
    const fromViews = sumRemainingToPayUsd(orderViews);
    assert.equal(fromViews, fromMatched);
    assert.equal(fromViews, 33.45);
  });
});
