/**
 * P1 — Overpayment SSOT: Debt vs incoming payment (USD).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { evaluatePaymentBusinessRules } from "@/lib/payment-business-validation";
import { classifyMethodIntakeGate } from "@/lib/cash-control-intake-breakdown";
import { PAYMENT_BUCKET_LABELS } from "@/lib/payment-breakdown-shared";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

function order(remaining: number, methods?: Array<{ method: "CASH" | "BANK_TRANSFER"; planned: number }>): PaymentIntakeOrderRow {
  const total = remaining;
  const breakdown =
    methods?.map((m) => ({
      method: m.method,
      label: m.method === "CASH" ? "מזומן" : "העברה בנקאית",
      plannedUsd: m.planned,
      paidUsd: 0,
      remainingUsd: m.planned,
    })) ??
    [
      {
        method: "CASH" as const,
        label: "מזומן",
        plannedUsd: remaining,
        paidUsd: 0,
        remainingUsd: remaining,
      },
    ];
  return {
    id: "o1",
    orderNumber: "TR-001",
    paymentCode: null,
    dateYmd: "2026-07-01",
    week: "2026-W27",
    rate: "3.00",
    amountUsd: String(Math.max(0, remaining - 100)),
    commissionUsd: "100",
    totalIls: "0",
    totalAmountUsd: String(total),
    dbPaidUsd: "0",
    dbRemainingUsd: String(remaining),
    status: "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: breakdown.length > 1,
    breakdown,
    actualMethods: [],
    hasMethodDeviation: false,
  };
}

describe("P1 Overpayment — SSOT computePaymentOverpayment", () => {
  it("Debt $100 + Payment $80 → no overpayment, debt $20 remains", () => {
    const r = computePaymentOverpayment(100, 80);
    assert.equal(r.hasOverpayment, false);
    assert.equal(r.overpaymentUsd, 0);
    assert.equal(r.closesDebtUsd, 80);
    assert.equal(r.openDebtUsd, 100);
  });

  it("Debt $100 + Payment $100 → no overpayment, debt $0", () => {
    const r = computePaymentOverpayment(100, 100);
    assert.equal(r.hasOverpayment, false);
    assert.equal(r.overpaymentUsd, 0);
    assert.equal(r.closesDebtUsd, 100);
  });

  it("Debt $100 + Payment $110 → overpayment +$10", () => {
    const r = computePaymentOverpayment(100, 110);
    assert.equal(r.hasOverpayment, true);
    assert.equal(r.overpaymentUsd, 10);
    assert.equal(r.closesDebtUsd, 100);
  });

  it("Debt $2.72 + Payment $8 → overpayment +$5.28", () => {
    const r = computePaymentOverpayment(2.72, 8);
    assert.equal(r.hasOverpayment, true);
    assert.equal(r.overpaymentUsd, 5.28);
    assert.equal(r.closesDebtUsd, 2.72);
  });

  it("Debt $100 + ₪330 @3 ($110) → overpayment +$10", () => {
    const r = computePaymentOverpayment(100, 110);
    assert.equal(r.hasOverpayment, true);
    assert.equal(r.overpaymentUsd, 10);
  });
});

describe("P1 Overpayment — composite payments (method gate + business rules)", () => {
  const cashBankOrder = order(100, [
    { method: "CASH", planned: 70 },
    { method: "BANK_TRANSFER", planned: 30 },
  ]);

  it("Cash $70 + Transfer $40 vs debt $100 → overpayment +$10", () => {
    const gate = classifyMethodIntakeGate({
      orders: [cashBankOrder],
      includedOrderIds: null,
      enteredByBucket: [
        { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: 70 },
        { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: 40 },
      ],
      totalPaymentUsd: 110,
    });
    assert.equal(gate.kind, "SURPLUS_AFTER_CLOSURE");
    if (gate.kind === "SURPLUS_AFTER_CLOSURE") {
      assert.equal(gate.surplusUsd, 10);
      assert.equal(gate.totalDebtUsd, 100);
    }

    const preview = computePaymentOverpayment(100, 70 + 40);
    assert.equal(preview.hasOverpayment, true);
    assert.equal(preview.overpaymentUsd, 10);
  });

  it("Cash ₪150@3 ($50) + Transfer $60 vs debt $100 → overpayment +$10", () => {
    const gate = classifyMethodIntakeGate({
      orders: [cashBankOrder],
      includedOrderIds: null,
      enteredByBucket: [
        { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: 50 },
        { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: 60 },
      ],
      totalPaymentUsd: 110,
    });
    assert.equal(gate.kind, "SURPLUS_AFTER_CLOSURE");
    const preview = computePaymentOverpayment(100, 110);
    assert.equal(preview.overpaymentUsd, 10);
  });

  it("Backend blocks save without surplusDisposition when overpayment exists", () => {
    const decision = evaluatePaymentBusinessRules({
      plannedByMethod: [],
      enteredByMethod: [
        { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: 110 },
      ],
      totalDebtUsd: 100,
      totalPaymentUsd: 110,
    });
    assert.equal(decision.code, "CHOOSE_SURPLUS_DISPOSITION");
    assert.equal(decision.surplusUsd, 10);
    assert.equal(decision.ok, false);

    const withDisposition = evaluatePaymentBusinessRules({
      plannedByMethod: [],
      enteredByMethod: [
        { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: 110 },
      ],
      totalDebtUsd: 100,
      totalPaymentUsd: 110,
      surplusDisposition: "credit",
    });
    assert.equal(withDisposition.code, "READY");
    assert.equal(withDisposition.surplusUsd, 10);
  });
});
