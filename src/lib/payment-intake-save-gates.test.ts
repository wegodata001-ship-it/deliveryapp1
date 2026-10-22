import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMethodIntakeGate,
  computeIntakeSaveDeviations,
  filterIntakeCorrectionRowsForDisplay,
  intakeHasMethodMismatch,
} from "@/lib/cash-control-intake-breakdown";
import { compareRemainingPlannedToEntered } from "@/lib/payment-breakdown-shared";
import {
  canProceedToOverpaymentResolution,
  describePostAdjustmentValidation,
  evaluatePaymentIntakeSaveGates,
} from "@/lib/payment-intake-save-gates";
import { plannedBreakdownWasWiped } from "@/lib/payment-method-auto-adjustment";
import {
  applyIntentOrderChangesToIntakeOrders,
  planPaymentIntentAdjustments,
  resultingCustomerCreditUsd,
  resultingCustomerFeeUsd,
} from "@/lib/payment-method-payment-intent";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";
import { buildLivePaymentMethodControlRows } from "@/lib/payment-intake-method-control";
import type { LivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";

const DEBT = 758.01;

function order101(params: {
  breakdown: Array<{ method: string; label: string; plannedUsd: number }>;
}): PaymentIntakeOrderRow {
  return {
    id: "ord-101",
    orderNumber: "TR-140-0001",
    paymentCode: null,
    dateYmd: "2026-09-01",
    week: "AH-140",
    rate: "3.70",
    amountUsd: DEBT.toFixed(2),
    commissionUsd: "0.00",
    totalIls: DEBT.toFixed(2),
    totalAmountUsd: "2031.84",
    dbPaidUsd: "1273.83",
    dbRemainingUsd: DEBT.toFixed(2),
    status: "partial",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: params.breakdown.length > 1,
    breakdown: params.breakdown.map((row) => ({
      method: row.method,
      label: row.label,
      currency: "USD" as const,
      planned: row.plannedUsd,
      plannedUsd: row.plannedUsd,
      paid: 0,
      paidUsd: 0,
      remaining: row.plannedUsd,
      remainingUsd: row.plannedUsd,
    })),
  } as PaymentIntakeOrderRow;
}

const creditPlanned = order101({
  breakdown: [{ method: "CREDIT", label: "אשראי", plannedUsd: DEBT }],
});

describe("independent payment intake save gates — customer 101", () => {
  it("$725 cash+bank: mismatch blocks, adjustment keeps planned methods, then save allowed", () => {
    const entered = [
      { bucket: "CASH" as const, label: "מזומן", enteredUsd: 310 },
      { bucket: "BANK_TRANSFER" as const, label: "העברה בנקאית", enteredUsd: 415 },
    ];
    const before = evaluatePaymentIntakeSaveGates({
      orders: [creditPlanned],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 725,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);
    assert.equal(before.overpaymentCheck.detected, false);
    assert.equal(before.saveAllowed, false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(creditPlanned)],
      intents: [
        { method: "CASH", currency: "USD", amountNative: 310 },
        { method: "BANK_TRANSFER", currency: "USD", amountNative: 415 },
      ],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.orderChanges.length > 0);
    for (const change of plan.orderChanges) {
      assert.equal(plannedBreakdownWasWiped(change.beforeBreakdown, change.afterBreakdown), false);
      assert.ok(change.afterBreakdown.length > 0);
    }

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(creditPlanned)], plan.orderChanges);
    const after = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 725,
      openDebtUsd: DEBT,
    });
    assert.equal(after.methodCheck.ok, true);
    assert.equal(after.overpaymentCheck.detected, false);
    assert.equal(after.saveAllowed, true);
    assert.equal(Number((DEBT - 725).toFixed(2)), 33.01);
  });

  it("$800 cash: overpayment $41.99 blocks save until disposition", () => {
    const cashPlanned = order101({
      breakdown: [{ method: "CASH", label: "מזומן", plannedUsd: DEBT }],
    });
    const entered = [{ bucket: "CASH" as const, label: "מזומן", enteredUsd: 800 }];
    const over = computePaymentOverpayment(DEBT, 800);
    assert.equal(over.hasOverpayment, true);
    assert.equal(over.overpaymentUsd, 41.99);

    const blocked = evaluatePaymentIntakeSaveGates({
      orders: [cashPlanned],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(blocked.methodCheck.ok, true);
    assert.equal(blocked.overpaymentCheck.detected, true);
    assert.equal(blocked.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(blocked.overpaymentCheck.ok, false);
    assert.equal(blocked.saveAllowed, false);

    const allowed = evaluatePaymentIntakeSaveGates({
      orders: [cashPlanned],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
      surplusDisposition: "credit",
    });
    assert.equal(allowed.overpaymentCheck.ok, true);
    assert.equal(allowed.saveAllowed, true);
    assert.equal(canProceedToOverpaymentResolution(blocked), true);
  });

  it("regression 1: planned cash $758.01 + actual cash $758.01 — no mismatch, no overpay", () => {
    const order = order101({
      breakdown: [{ method: "CASH", label: "מזומן", plannedUsd: DEBT }],
    });
    const gates = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: DEBT }],
      totalPaymentUsd: DEBT,
      openDebtUsd: DEBT,
    });
    assert.equal(gates.methodCheck.ok, true);
    assert.equal(gates.overpaymentCheck.detected, false);
    assert.equal(gates.saveAllowed, true);
    assert.equal(canProceedToOverpaymentResolution(gates), false);
  });

  it("regression 2: planned bank $758.01 + actual cash $758.01 — mismatch, no overpay", () => {
    const order = order101({
      breakdown: [{ method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: DEBT }],
    });
    const gates = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: DEBT }],
      totalPaymentUsd: DEBT,
      openDebtUsd: DEBT,
    });
    assert.equal(gates.methodCheck.ok, false);
    assert.equal(gates.overpaymentCheck.detected, false);
    assert.equal(canProceedToOverpaymentResolution(gates), false);
  });

  it("regression 3: planned bank $758.01 + actual cash $800 — mismatch AND overpay $41.99", () => {
    const order = order101({
      breakdown: [{ method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: DEBT }],
    });
    const entered = [{ bucket: "CASH" as const, label: "מזומן", enteredUsd: 800 }];
    const before = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);
    assert.equal(before.overpaymentCheck.detected, true);
    assert.equal(before.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(canProceedToOverpaymentResolution(before), false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(order)],
      intents: [{ method: "CASH", currency: "USD", amountNative: 800 }],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.closesDebtUsd, DEBT);
    assert.equal(plan.overpaymentUsd, 41.99);
    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(order)], plan.orderChanges);
    const after = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(after.methodCheck.ok, true);
    assert.equal(after.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(canProceedToOverpaymentResolution(after), true);
  });

  it("regression 4: planned cash $758.01 + actual cash $800 — $41.99 is overpayment, not method mismatch", () => {
    const order = order101({
      breakdown: [{ method: "CASH", label: "מזומן", plannedUsd: DEBT }],
    });
    const gates = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 800 }],
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(gates.methodCheck.ok, true);
    assert.equal(gates.methodCheck.kind, "SURPLUS_AFTER_CLOSURE");
    assert.equal(gates.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(canProceedToOverpaymentResolution(gates), true);
  });

  it("101 collectible cash $412.37 / bank $345.64 vs actual cash $800 is method mismatch + overpay", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 412.37 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 345.64 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 4105.36,
          plannedUsd: 4105.36,
          paid: 3692.99,
          paidUsd: 3692.99,
          remaining: 412.37,
          remainingUsd: 412.37,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 2762.64,
          plannedUsd: 2762.64,
          paid: 2417,
          paidUsd: 2417,
          remaining: 345.64,
          remainingUsd: 345.64,
        },
      ],
    } as PaymentIntakeOrderRow;
    const gates = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 800 }],
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(gates.methodCheck.ok, false);
    assert.equal(gates.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(canProceedToOverpaymentResolution(gates), false);
  });

  it("mismatch + overpayment stay independent after adjustment", () => {
    const entered = [{ bucket: "CASH" as const, label: "מזומן", enteredUsd: 800 }];
    const before = evaluatePaymentIntakeSaveGates({
      orders: [creditPlanned],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);
    assert.equal(before.overpaymentCheck.detected, true);
    assert.equal(before.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(before.saveAllowed, false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(creditPlanned)],
      intents: [{ method: "CASH", currency: "USD", amountNative: 800 }],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.hasOverpayment, true);
    assert.equal(plan.overpaymentUsd, 41.99);
    assert.equal(plan.intents[0]!.amountNative, 800);
    for (const change of plan.orderChanges) {
      assert.equal(plannedBreakdownWasWiped(change.beforeBreakdown, change.afterBreakdown), false);
    }

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(creditPlanned)], plan.orderChanges);
    const afterAdjust = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(afterAdjust.methodCheck.ok, true);
    assert.equal(afterAdjust.overpaymentCheck.detected, true);
    assert.equal(afterAdjust.overpaymentCheck.ok, false);
    assert.equal(afterAdjust.saveAllowed, false);

    const afterBoth = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
      surplusDisposition: "credit",
    });
    assert.equal(afterBoth.methodCheck.ok, true);
    assert.equal(afterBoth.overpaymentCheck.ok, true);
    assert.equal(afterBoth.saveAllowed, true);
  });

  it("101 $800 cash: close physical bank remaining so post-validation is surplus $41.99 not mismatch", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 3922.54 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 2945.46 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 3922.54,
          plannedUsd: 3922.54,
          paid: 3000,
          paidUsd: 3000,
          remaining: 344.17,
          remainingUsd: 344.17,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 2945.46,
          plannedUsd: 2945.46,
          paid: 1836.16,
          paidUsd: 1836.16,
          remaining: 413.84,
          remainingUsd: 413.84,
        },
      ],
    } as PaymentIntakeOrderRow;
    const entered = [{ bucket: "CASH" as const, label: "מזומן", enteredUsd: 800 }];
    const before = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(order)],
      intents: [{ method: "CASH", currency: "USD", amountNative: 800 }],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const afterLines = plan.orderChanges[0]!.afterBreakdown;
    const bank = afterLines.find((row) => row.paymentMethod === "BANK_TRANSFER");
    const cash = afterLines.find((row) => row.paymentMethod === "CASH");
    assert.equal(Number(bank?.amount), 1836.16);
    assert.equal(Number(cash?.amount), 5031.84);
    assert.equal(plan.overpaymentUsd, 41.99);

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(order)], plan.orderChanges);
    const bankRem = fresh[0]!.breakdown.find((row) => row.method === "BANK_TRANSFER")?.remainingUsd ?? -1;
    assert.equal(bankRem, 0);

    const after = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
      surplusDisposition: "commission",
    });
    assert.equal(after.methodCheck.ok, true);
    assert.equal(after.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(after.overpaymentCheck.ok, true);
    assert.equal(after.saveAllowed, true);
  });

  it("101 remaining cash $412.37 / bank $345.64 vs actual $300 / $500 is a method mismatch + $41.99 overpayment", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 4105.36 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 2762.64 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 4105.36,
          plannedUsd: 4105.36,
          paid: 3692.99,
          paidUsd: 3692.99,
          remaining: 412.37,
          remainingUsd: 412.37,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 2762.64,
          plannedUsd: 2762.64,
          paid: 2417,
          paidUsd: 2417,
          remaining: 345.64,
          remainingUsd: 345.64,
        },
      ],
    } as PaymentIntakeOrderRow;
    const entered = [
      { bucket: "CASH" as const, label: "מזומן", enteredUsd: 300 },
      { bucket: "BANK_TRANSFER" as const, label: "העברה בנקאית", enteredUsd: 500 },
    ];
    const diffs = compareRemainingPlannedToEntered(
      [
        { bucket: "CASH", label: "מזומן", plannedUsd: 4105.36, remainingUsd: 412.37 },
        { bucket: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 2762.64, remainingUsd: 345.64 },
      ],
      entered,
    );
    const cash = diffs.find((row) => row.bucket === "CASH")!;
    const bank = diffs.find((row) => row.bucket === "BANK_TRANSFER")!;
    assert.equal(cash.remainingPlannedUsd, 412.37);
    assert.equal(cash.actualUsd, 300);
    assert.equal(cash.differenceUsd, -112.37);
    assert.equal(bank.remainingPlannedUsd, 345.64);
    assert.equal(bank.actualUsd, 500);
    assert.equal(bank.differenceUsd, 154.36);

    const gate = classifyMethodIntakeGate({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
    });
    assert.equal(gate.kind, "METHOD_DEVIATION");

    const deviations = computeIntakeSaveDeviations({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      formRateN: 3.7,
      totalPaymentUsd: 800,
    });
    assert.equal(intakeHasMethodMismatch(deviations), true);
    assert.ok(filterIntakeCorrectionRowsForDisplay(deviations, "surplus").some((row) => row.rowTone === "excess"));

    const kpis: LivePaymentFormKpis = {
      totalPaymentUsd: 800,
      cash: { totalUsd: 300, enteredUsd: 300, enteredIls: 0 },
      bankTransfer: { totalUsd: 500, enteredUsd: 500, enteredIls: 0 },
      credit: { totalUsd: 0, enteredUsd: 0, enteredIls: 0 },
      checks: { totalUsd: 0, enteredUsd: 0, enteredIls: 0 },
      other: { totalUsd: 0, enteredUsd: 0, enteredIls: 0 },
    };
    const pmc = buildLivePaymentMethodControlRows([order], null, kpis, 800);
    assert.equal(pmc.some((row) => row.status === "excess"), true);

    const before = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);
    assert.equal(before.overpaymentCheck.detected, true);
    assert.equal(before.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(before.saveAllowed, false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(order)],
      intents: [
        { method: "CASH", currency: "USD", amountNative: 300 },
        { method: "BANK_TRANSFER", currency: "USD", amountNative: 500 },
      ],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.orderChanges.length > 0);
    for (const change of plan.orderChanges) {
      assert.equal(plannedBreakdownWasWiped(change.beforeBreakdown, change.afterBreakdown), false);
      assert.ok(change.afterBreakdown.length > 0);
    }

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(order)], plan.orderChanges);
    const afterAdjust = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(afterAdjust.methodCheck.ok, true);
    assert.equal(afterAdjust.overpaymentCheck.detected, true);
    assert.equal(afterAdjust.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(afterAdjust.saveAllowed, false);
  });

  it("101 $760 bank+cash: adjust only $758.01 then overpayment $1.99 still blocks save", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 412.37 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 345.64 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 412.37,
          plannedUsd: 412.37,
          paid: 0,
          paidUsd: 0,
          remaining: 412.37,
          remainingUsd: 412.37,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 345.64,
          plannedUsd: 345.64,
          paid: 0,
          paidUsd: 0,
          remaining: 345.64,
          remainingUsd: 345.64,
        },
      ],
    } as PaymentIntakeOrderRow;
    const entered = [
      { bucket: "CASH" as const, label: "מזומן", enteredUsd: 250 },
      { bucket: "BANK_TRANSFER" as const, label: "העברה בנקאית", enteredUsd: 510 },
    ];
    const before = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 760,
      openDebtUsd: DEBT,
    });
    assert.equal(before.methodCheck.ok, false);
    assert.equal(before.overpaymentCheck.overpaymentUsd, 1.99);
    assert.equal(before.saveAllowed, false);

    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(order)],
      intents: [
        { method: "BANK_TRANSFER", currency: "USD", amountNative: 510 },
        { method: "CASH", currency: "USD", amountNative: 250 },
      ],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.closesDebtUsd, 758.01);
    assert.equal(plan.overpaymentUsd, 1.99);
    for (const change of plan.orderChanges) {
      assert.equal(plannedBreakdownWasWiped(change.beforeBreakdown, change.afterBreakdown), false);
    }

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(order)], plan.orderChanges);
    const afterAdjust = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 760,
      openDebtUsd: DEBT,
    });
    assert.equal(afterAdjust.methodCheck.ok, true);
    assert.equal(afterAdjust.overpaymentCheck.detected, true);
    assert.equal(afterAdjust.overpaymentCheck.overpaymentUsd, 1.99);
    assert.equal(afterAdjust.saveAllowed, false);

    const afterCredit = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 760,
      openDebtUsd: DEBT,
      surplusDisposition: "credit",
    });
    assert.equal(afterCredit.saveAllowed, true);
    const afterCommission = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 760,
      openDebtUsd: DEBT,
      surplusDisposition: "commission",
    });
    assert.equal(afterCommission.saveAllowed, true);
  });

  it("partial $500 under remaining planned is not a method mismatch", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 412.37 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 345.64 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 412.37,
          plannedUsd: 412.37,
          paid: 0,
          paidUsd: 0,
          remaining: 412.37,
          remainingUsd: 412.37,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 345.64,
          plannedUsd: 345.64,
          paid: 0,
          paidUsd: 0,
          remaining: 345.64,
          remainingUsd: 345.64,
        },
      ],
    } as PaymentIntakeOrderRow;
    const entered = [
      { bucket: "CASH" as const, label: "מזומן", enteredUsd: 300 },
      { bucket: "BANK_TRANSFER" as const, label: "העברה בנקאית", enteredUsd: 200 },
    ];
    const gates = evaluatePaymentIntakeSaveGates({
      orders: [order],
      includedOrderIds: null,
      enteredByBucket: entered,
      totalPaymentUsd: 500,
      openDebtUsd: DEBT,
    });
    assert.equal(gates.methodCheck.ok, true);
    assert.equal(gates.overpaymentCheck.detected, false);
    assert.equal(gates.saveAllowed, true);
  });

  it("101 physicalPaid wins over collectible-derived paid so $800 COMMISSION save is allowed", () => {
    const order = {
      ...order101({
        breakdown: [
          { method: "CASH", label: "מזומן", plannedUsd: 3922.54 },
          { method: "BANK_TRANSFER", label: "העברה בנקאית", plannedUsd: 2945.46 },
        ],
      }),
      breakdown: [
        {
          method: "CASH",
          label: "מזומן",
          currency: "USD" as const,
          planned: 3922.54,
          plannedUsd: 3922.54,
          paid: 3578.37,
          paidUsd: 3578.37,
          physicalPaid: 3000,
          remaining: 344.17,
          remainingUsd: 344.17,
        },
        {
          method: "BANK_TRANSFER",
          label: "העברה בנקאית",
          currency: "USD" as const,
          planned: 2945.46,
          plannedUsd: 2945.46,
          paid: 2531.62,
          paidUsd: 2531.62,
          physicalPaid: 1836.16,
          remaining: 413.84,
          remainingUsd: 413.84,
        },
      ],
    } as PaymentIntakeOrderRow;
    const plan = planPaymentIntentAdjustments({
      orders: [structuredClone(order)],
      intents: [{ method: "CASH", currency: "USD", amountNative: 800 }],
      customerOpenDebtUsd: DEBT,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.closesDebtUsd, DEBT);
    assert.equal(plan.overpaymentUsd, 41.99);
    const bank = plan.orderChanges[0]!.afterBreakdown.find((row) => row.paymentMethod === "BANK_TRANSFER");
    const cash = plan.orderChanges[0]!.afterBreakdown.find((row) => row.paymentMethod === "CASH");
    assert.equal(Number(bank?.amount), 1836.16);
    assert.equal(Number(cash?.amount), 5031.84);

    const fresh = applyIntentOrderChangesToIntakeOrders([structuredClone(order)], plan.orderChanges);
    assert.equal(fresh[0]!.breakdown.find((row) => row.method === "BANK_TRANSFER")?.remainingUsd, 0);
    const credit = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 800 }],
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
      surplusDisposition: "credit",
    });
    assert.equal(credit.methodCheck.ok, true);
    assert.equal(credit.overpaymentCheck.overpaymentUsd, 41.99);
    assert.equal(credit.saveAllowed, true);
    assert.equal(credit.reason, null);
    const commission = evaluatePaymentIntakeSaveGates({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 800 }],
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
      surplusDisposition: "commission",
    });
    assert.equal(commission.saveAllowed, true);
    assert.equal(resultingCustomerCreditUsd(0, 41.99), 41.99);
    assert.notEqual(resultingCustomerCreditUsd(0, 41.99), 1315.82);
    assert.equal(resultingCustomerFeeUsd(177.5, 41.99), 219.49);
    const debug = describePostAdjustmentValidation({
      orders: fresh,
      includedOrderIds: null,
      enteredByBucket: [{ bucket: "CASH", label: "מזומן", enteredUsd: 800 }],
      totalPaymentUsd: 800,
      openDebtUsd: DEBT,
    });
    assert.equal(debug.debtToCloseUsd, DEBT);
    assert.equal(debug.overpaymentUsd, 41.99);
    assert.notEqual(debug.validatorExpected, 800);
  });
});
