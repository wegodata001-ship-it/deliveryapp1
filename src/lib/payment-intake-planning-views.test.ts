/**
 * SSOT — תצוגות תכנון תשלום נגזרות מאותו snapshot של הזמנות.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derivePaymentIntakePlanningViews } from "@/lib/payment-intake-planning-views";
import type { LivePaymentFormKpis, LivePaymentMethodBucket } from "@/lib/payment-intake-live-kpi";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

function bucket(totalUsd: number): LivePaymentMethodBucket {
  return { totalUsd, enteredUsd: totalUsd, enteredIls: 0 };
}

function emptyKpis(overrides?: Partial<LivePaymentFormKpis>): LivePaymentFormKpis {
  return {
    totalPaymentUsd: 0,
    cash: bucket(0),
    bankTransfer: bucket(0),
    credit: bucket(0),
    checks: bucket(0),
    other: bucket(0),
    ...overrides,
  };
}

function sampleOrder(
  partial: Partial<PaymentIntakeOrderRow> & Pick<PaymentIntakeOrderRow, "id">,
): PaymentIntakeOrderRow {
  const { id, ...rest } = partial;
  return {
    id,
    orderNumber: "TR-1",
    paymentCode: null,
    dateYmd: "2026-07-01",
    week: "W1",
    rate: "3.5",
    amountUsd: "100",
    commissionUsd: "0",
    totalIls: "350",
    totalAmountUsd: "100",
    dbPaidUsd: "0",
    dbRemainingUsd: "100",
    status: "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      { method: "CASH", label: "מזומן", plannedUsd: 60, paidUsd: 0, remainingUsd: 60 },
      { method: "BANK_TRANSFER", label: "העברה", plannedUsd: 40, paidUsd: 0, remainingUsd: 40 },
    ],
    actualMethods: [],
    hasMethodDeviation: false,
    isPriorWeekOpenDebt: false,
    ...rest,
  };
}

describe("derivePaymentIntakePlanningViews (SSOT)", () => {
  it("builds button rows and modal detail rows from the same orders snapshot", () => {
    const orders = [sampleOrder({ id: "o1", orderNumber: "TR-100" })];
    const kpis = emptyKpis({
      cash: bucket(60),
      totalPaymentUsd: 60,
    });
    const views = derivePaymentIntakePlanningViews(orders, null, kpis, 60);

    assert.equal(views.showMethodControl, true);
    assert.ok(views.methodViews.length > 0);

    const cashDetail = views.methodViews.find((r) => r.bucket === "CASH" && r.orderId === "o1");
    assert.equal(cashDetail?.plannedUsd, 60);
    assert.equal(cashDetail?.formEnteredUsd, 60);
    assert.equal(cashDetail?.formRemainingUsd, 0);

    const cashButton = views.methodControlRows.find((r) => r.bucket === "CASH");
    assert.equal(cashButton?.plannedUsd, 60);
    assert.equal(cashButton?.enteredUsd, 60);
  });

  it("keeps detail rows scoped when includedOrderIds filters", () => {
    const orders = [
      sampleOrder({ id: "o1", orderNumber: "A" }),
      sampleOrder({ id: "o2", orderNumber: "B" }),
    ];
    const views = derivePaymentIntakePlanningViews(orders, ["o1"], emptyKpis(), 0);
    assert.ok(views.methodViews.every((r) => !r.orderId || r.orderId === "o1"));
    assert.equal(views.methodViewSummary.orderCount, 1);
  });
});
