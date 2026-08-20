/**
 * QA — קליטת הזמנה ≠ קליטת תשלום
 * תשלום מורכב מתוכנן לא נספר כ-paid עד שיש Payment records.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOrderLedgerView,
  deriveOrderPaymentDisplayStatus,
  reconcileOrderBreakdownWithLedger,
} from "@/lib/order-remaining-debt";
import { computeOpenDebtUsd } from "@/lib/finance-data/ledger/compute-open-debt";
import {
  hasActualPaymentLinesInOrderCapture,
  orderCaptureActualPaymentError,
} from "@/lib/order-capture-actual-payment-guard";

describe("Order capture — planned composite is not paid", () => {
  it("create order + CASH method → paid = 0", () => {
    const ledger = computeOrderLedgerView({
      orderId: "cash",
      totalUsd: 100,
      amountUsd: 100,
      commissionUsd: 0,
      paidUsd: 0,
    });
    assert.equal(ledger.paidUsd, 0);
    assert.equal(ledger.remainingUsd, 100);
  });

  it("create order + BANK_TRANSFER method → paid = 0", () => {
    const ledger = computeOrderLedgerView({
      orderId: "bank",
      totalUsd: 200,
      amountUsd: 200,
      commissionUsd: 0,
      paidUsd: 0,
    });
    assert.equal(ledger.paidUsd, 0);
    assert.equal(ledger.remainingUsd, 200);
  });

  it("ledger: no payments → paid 0, remaining = total", () => {
    const total = 1616;
    const ledger = computeOrderLedgerView({
      orderId: "o1",
      totalUsd: total,
      amountUsd: 1600,
      commissionUsd: 16,
      paidUsd: 0,
    });
    assert.equal(ledger.paidUsd, 0);
    assert.equal(ledger.remainingUsd, total);
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: total, paidUsd: 0 }), "unpaid");
  });

  it("open debt SSOT matches ledger remaining", () => {
    const snap = computeOpenDebtUsd({ orderId: "o1", totalUsd: 1616, paidUsd: 0 });
    assert.equal(snap.openDebtUsd, 1616);
    assert.equal(snap.paidUsd, 0);
  });

  it("partial payment via intake only — $1000 of $1616", () => {
    const ledger = computeOrderLedgerView({
      orderId: "o1",
      totalUsd: 1616,
      amountUsd: 1600,
      commissionUsd: 16,
      paidUsd: 1000,
    });
    assert.equal(ledger.paidUsd, 1000);
    assert.equal(ledger.remainingUsd, 616);
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 1616, paidUsd: 1000 }), "partial");
  });

  it("full actual payment only after payment intake closes remaining to zero", () => {
    const ledger = computeOrderLedgerView({
      orderId: "o1",
      totalUsd: 1616,
      amountUsd: 1600,
      commissionUsd: 16,
      paidUsd: 1616,
    });
    assert.equal(ledger.paidUsd, 1616);
    assert.equal(ledger.remainingUsd, 0);
    assert.equal(deriveOrderPaymentDisplayStatus({ totalUsd: 1616, paidUsd: 1616 }), "paid");
  });

  it("reconcile breakdown: stale paid=planned with zero payments → paid 0", () => {
    const breakdown = reconcileOrderBreakdownWithLedger(
      [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD",
          planned: 1000,
          paid: 1000,
          remaining: 0,
          plannedUsd: 1000,
          paidUsd: 1000,
          remainingUsd: 0,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה",
          currency: "USD",
          planned: 616,
          paid: 616,
          remaining: 0,
          plannedUsd: 616,
          paidUsd: 616,
          remainingUsd: 0,
        },
      ],
      1616,
    );
    const sumPaid = breakdown.reduce((s, r) => s + (r.paidUsd ?? 0), 0);
    const sumRem = breakdown.reduce((s, r) => s + (r.remainingUsd ?? 0), 0);
    assert.equal(sumPaid, 0);
    assert.equal(sumRem, 1616);
  });

  it("complex split covering 100% of the order is still planned only", () => {
    const breakdown = reconcileOrderBreakdownWithLedger(
      [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD",
          planned: 1000,
          paid: 0,
          remaining: 1000,
          plannedUsd: 1000,
          paidUsd: 0,
          remainingUsd: 1000,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה",
          currency: "USD",
          planned: 818,
          paid: 0,
          remaining: 818,
          plannedUsd: 818,
          paidUsd: 0,
          remainingUsd: 818,
        },
      ],
      1818,
    );
    assert.equal(breakdown.reduce((s, r) => s + (r.paidUsd ?? 0), 0), 0);
    assert.equal(breakdown.reduce((s, r) => s + (r.remainingUsd ?? 0), 0), 1818);
  });

  it("editing or deleting complex split does not manufacture actual paid", () => {
    const editedBreakdown = reconcileOrderBreakdownWithLedger(
      [
        {
          method: "BANK_TRANSFER",
          label: "העברה",
          currency: "USD",
          planned: 1818,
          paid: 0,
          remaining: 1818,
          plannedUsd: 1818,
          paidUsd: 0,
          remainingUsd: 1818,
        },
      ],
      1818,
    );
    assert.equal(editedBreakdown[0]?.paidUsd, 0);
    assert.equal(editedBreakdown[0]?.remainingUsd, 1818);
  });
});

describe("Order capture actual payment guard", () => {
  it("accepts planned order capture without actual payment lines", () => {
    assert.equal(hasActualPaymentLinesInOrderCapture(undefined), false);
    assert.equal(hasActualPaymentLinesInOrderCapture([{ amountUsd: "" }]), false);
  });

  it("rejects legacy payloads that try to send actual payment lines during order capture", () => {
    assert.equal(
      hasActualPaymentLinesInOrderCapture([{ amountUsd: "1000.00" }, { amountUsd: "" }]),
      true,
    );
    assert.match(orderCaptureActualPaymentError(), /קליטת תשלום/);
  });
});
