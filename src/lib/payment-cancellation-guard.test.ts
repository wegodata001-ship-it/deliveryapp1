import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyInMemoryCancellation,
  assertCancellationInvariant,
  computeInMemoryBalances,
  evaluateCancellationInvariant,
  planPaymentCancellation,
  type InMemoryLedgerStore,
  type InMemoryPaymentRow,
} from "@/lib/payment-cancellation-effects";
import { scanPaymentCancellationIntegrity } from "@/lib/payment-cancellation-integrity";
import { linkedCommissionFeeWhere, linkedCreditPaymentWhere } from "@/lib/payment-cancellation-fees";

function pay(partial: Partial<InMemoryPaymentRow> & Pick<InMemoryPaymentRow, "id">): InMemoryPaymentRow {
  return {
    customerId: "cust-1",
    paymentNumber: 1,
    paymentCode: "TR-P-000100",
    businessType: "STANDARD",
    status: "ACTIVE",
    amountUsd: 500,
    orderId: "ord-1",
    ...partial,
  };
}

function baseStore(overrides: Partial<InMemoryLedgerStore> = {}): InMemoryLedgerStore {
  return {
    orders: [{ id: "ord-1", customerId: "cust-1", totalUsd: 500, commissionUsd: 0 }],
    payments: [pay({ id: "pay-1" })],
    fees: [],
    allocations: [{ id: "alloc-1", paymentId: "pay-1", method: "CASH", amountUsd: 500 }],
    audit: [],
    ...overrides,
  };
}

describe("TEST 1 — Payment רגיל", () => {
  it("cancel $500 against $500 debt restores debt and leaves fees/credit untouched", () => {
    const before = computeInMemoryBalances(baseStore(), "cust-1");
    assert.equal(before.openDebtUsd, 0);
    assert.equal(before.paymentsUsd, 500);
    assert.equal(before.creditUsd, 0);
    assert.equal(before.feeBalanceUsd, 0);

    const { store } = applyInMemoryCancellation(baseStore(), "pay-1");
    assert.equal(store.payments[0]?.status, "CANCELLED");
    const after = computeInMemoryBalances(store, "cust-1");
    assert.equal(after.openDebtUsd, 500);
    assert.equal(after.paymentsUsd, 0);
    assert.equal(after.creditUsd, 0);
    assert.equal(after.feeBalanceUsd, 0);
    assert.equal(store.audit.length, 1);
  });
});

describe("TEST 2 — Payment חלקי", () => {
  it("cancel $300 against $500 debt returns debt to $500", () => {
    const store0 = baseStore({
      payments: [pay({ id: "pay-1", amountUsd: 300 })],
      allocations: [{ id: "alloc-1", paymentId: "pay-1", method: "CASH", amountUsd: 300 }],
    });
    assert.equal(computeInMemoryBalances(store0, "cust-1").openDebtUsd, 200);

    const { store } = applyInMemoryCancellation(store0, "pay-1");
    assert.equal(computeInMemoryBalances(store, "cust-1").openDebtUsd, 500);
  });
});

describe("TEST 3 — עודף → Credit", () => {
  it("cancel overpayment reverses debt and credit together", () => {
    const store0 = baseStore({
      payments: [
        pay({ id: "pay-1", amountUsd: 500 }),
        pay({
          id: "credit-1",
          businessType: "CUSTOMER_CREDIT",
          amountUsd: 100,
          orderId: null,
          paymentCode: null,
        }),
      ],
    });
    const before = computeInMemoryBalances(store0, "cust-1");
    assert.equal(before.openDebtUsd, 0);
    assert.equal(before.creditUsd, 100);

    const { store } = applyInMemoryCancellation(store0, "pay-1");
    const after = computeInMemoryBalances(store, "cust-1");
    assert.equal(store.payments.find((p) => p.id === "pay-1")?.status, "CANCELLED");
    assert.equal(store.payments.find((p) => p.id === "credit-1")?.status, "CANCELLED");
    assert.equal(after.openDebtUsd, 500);
    assert.equal(after.creditUsd, 0);
  });
});

describe("TEST 4 — עודף → Fees", () => {
  it("cancel surplus-to-commission fee and restore prior fee balance", () => {
    const store0 = baseStore({
      orders: [{ id: "ord-1", customerId: "cust-1", totalUsd: 500, commissionUsd: 50 }],
      payments: [
        pay({ id: "pay-1", amountUsd: 500 }),
        pay({
          id: "fee-pay-1",
          businessType: "ADJUSTMENT_FEE",
          amountUsd: 100,
          orderId: null,
          paymentCode: null,
        }),
      ],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "fee-pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "OPEN",
          amountUsd: 100,
        },
      ],
    });
    const before = computeInMemoryBalances(store0, "cust-1");
    assert.equal(before.openDebtUsd, 0);
    assert.equal(before.feeBalanceUsd, 150);

    const { store } = applyInMemoryCancellation(store0, "pay-1");
    assert.equal(store.payments.find((p) => p.id === "pay-1")?.status, "CANCELLED");
    assert.equal(store.payments.find((p) => p.id === "fee-pay-1")?.status, "CANCELLED");
    assert.equal(store.fees[0]?.status, "CANCELLED");
    const after = computeInMemoryBalances(store, "cust-1");
    assert.equal(after.openDebtUsd, 500);
    assert.equal(after.feeBalanceUsd, 50);
    assert.equal(store.audit[0]?.feeIds.includes("fee-1"), true);
  });
});

describe("TEST 5 — מספר אמצעי תשלום", () => {
  it("cancel mixed cash/bank/usd-ils capture restores pre-intake balances", () => {
    const store0 = baseStore({
      payments: [pay({ id: "pay-1", amountUsd: 500 })],
      allocations: [
        { id: "a1", paymentId: "pay-1", method: "CASH", amountUsd: 200 },
        { id: "a2", paymentId: "pay-1", method: "BANK_TRANSFER", amountUsd: 200 },
        { id: "a3", paymentId: "pay-1", method: "CASH", amountUsd: 100 },
      ],
    });
    const { store } = applyInMemoryCancellation(store0, "pay-1");
    assert.equal(store.allocations.length, 3);
    assert.equal(store.allocations.every((a) => a.paymentId === "pay-1"), true);
    const after = computeInMemoryBalances(store, "cust-1");
    assert.equal(after.openDebtUsd, 500);
    assert.equal(after.paymentsUsd, 0);
  });
});

describe("TEST 6 — ביטול כפול", () => {
  it("second cancel is idempotent and does not write another reversal", () => {
    const first = applyInMemoryCancellation(baseStore(), "pay-1");
    const second = applyInMemoryCancellation(first.store, "pay-1");
    assert.equal(second.alreadyCancelled, true);
    assert.equal(second.store.audit.length, 1);
    assert.equal(computeInMemoryBalances(second.store, "cust-1").openDebtUsd, 500);
  });
});

describe("TEST 7 — failure באמצע transaction", () => {
  it("rolls back so Payment and Fee both stay ACTIVE", () => {
    const store0 = baseStore({
      payments: [
        pay({ id: "pay-1", amountUsd: 500 }),
        pay({
          id: "fee-pay-1",
          businessType: "ADJUSTMENT_FEE",
          amountUsd: 100,
          orderId: null,
          paymentCode: null,
        }),
      ],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "fee-pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "OPEN",
          amountUsd: 100,
        },
      ],
    });
    assert.throws(
      () => applyInMemoryCancellation(store0, "pay-1", { failAfter: "payment-cancelled" }),
      /TEST_FAIL_AFTER_PAYMENT_CANCELLED/,
    );
    assert.equal(store0.payments.find((p) => p.id === "pay-1")?.status, "ACTIVE");
    assert.equal(store0.fees[0]?.status, "OPEN");
  });
});

describe("invariant + linkage", () => {
  it("refuses commit when a fee stays OPEN after payment cancel", () => {
    const result = evaluateCancellationInvariant({
      cancelledPaymentIds: ["pay-1"],
      remainingActivePayments: [],
      remainingActiveFees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "pay-1",
          paymentCaptureCode: "TR-P-000006",
          status: "OPEN",
          amountUsd: 3183.33,
        },
      ],
      remainingActiveCredits: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.violations[0]?.code, "ACTIVE_FEE_REMAINS");
    assert.throws(() =>
      assertCancellationInvariant({
        cancelledPaymentIds: ["pay-1"],
        remainingActivePayments: [],
        remainingActiveFees: [
          {
            id: "fee-1",
            customerId: "cust-1",
            paymentId: "pay-1",
            paymentCaptureCode: "TR-P-000006",
            status: "OPEN",
            amountUsd: 3183.33,
          },
        ],
        remainingActiveCredits: [],
      }),
    );
  });

  it("links fees by paymentId or capture code, not amount", () => {
    const where = linkedCommissionFeeWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1", "fee-pay-1"],
      paymentCaptureCode: "TR-P-000006",
    });
    assert.deepEqual(where.status, { not: "CANCELLED" });
    assert.ok(where.OR?.some((c) => JSON.stringify(c).includes("pay-1")));
    assert.ok(where.OR?.some((c) => JSON.stringify(c).includes("TR-P-000006")));
  });

  it("links credit by paymentNumber / paymentIds, not notes text", () => {
    const where = linkedCreditPaymentWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1"],
      paymentNumber: 14,
      paymentCaptureCode: "TR-P-000100",
    });
    assert.ok(where.AND);
  });

  it("already-cancelled plan does not target fees again", () => {
    const plan = planPaymentCancellation({
      targetPayment: pay({ id: "pay-1", status: "CANCELLED" }),
      siblingPayments: [pay({ id: "pay-1", status: "CANCELLED" })],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "CANCELLED",
          amountUsd: 100,
        },
      ],
    });
    assert.equal(plan.alreadyCancelled, true);
    assert.deepEqual(plan.feeIds, []);
  });
});

describe("integrity scan", () => {
  it("flags cancelled payment with leftover OPEN fee (Afnan bug)", () => {
    const anomalies = scanPaymentCancellationIntegrity({
      payments: [pay({ id: "pay-6", paymentCode: "TR-P-000006", status: "CANCELLED" })],
      fees: [
        {
          id: "fee-6",
          customerId: "cust-1",
          paymentId: "pay-6",
          paymentCaptureCode: "TR-P-000006",
          status: "OPEN",
          amountUsd: 3183.33,
        },
      ],
      allocations: [],
    });
    assert.equal(anomalies.some((a) => a.kind === "CANCELLED_PAYMENT_ACTIVE_FEE"), true);
  });

  it("flags reverse orphan: ACTIVE payment with cancelled child fee", () => {
    const anomalies = scanPaymentCancellationIntegrity({
      payments: [pay({ id: "pay-1" })],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "CANCELLED",
          amountUsd: 100,
        },
      ],
      allocations: [],
    });
    assert.equal(anomalies.some((a) => a.kind === "ACTIVE_PAYMENT_CANCELLED_CHILD_FEE"), true);
  });

  it("flags allocation without a payment", () => {
    const anomalies = scanPaymentCancellationIntegrity({
      payments: [],
      fees: [],
      allocations: [{ id: "alloc-x", paymentId: "missing-pay" }],
    });
    assert.equal(anomalies.some((a) => a.kind === "ORPHAN_ALLOCATION_MISSING_PAYMENT"), true);
  });

  it("does not flag used/reset credit while the original capture stays ACTIVE", () => {
    const anomalies = scanPaymentCancellationIntegrity({
      payments: [
        pay({ id: "pay-8", paymentCode: "TR-P-000008", status: "ACTIVE" }),
        pay({
          id: "credit-8",
          paymentCode: null,
          businessType: "CUSTOMER_CREDIT",
          status: "CANCELLED",
        }),
      ],
      fees: [],
      allocations: [{ id: "alloc-1", paymentId: "pay-8" }],
    });
    assert.deepEqual(anomalies, []);
  });

  it("passes a clean cancelled capture", () => {
    const anomalies = scanPaymentCancellationIntegrity({
      payments: [
        pay({ id: "pay-1", status: "CANCELLED" }),
        pay({ id: "fee-pay-1", businessType: "ADJUSTMENT_FEE", status: "CANCELLED", paymentCode: null }),
      ],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "fee-pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "CANCELLED",
          amountUsd: 100,
        },
      ],
      allocations: [{ id: "alloc-1", paymentId: "pay-1" }],
    });
    assert.deepEqual(anomalies, []);
  });
});

describe("end-to-end cancellation SSOT", () => {
  it("returns every surface to the pre-payment financial state and keeps history", () => {
    const beforePayment: InMemoryLedgerStore = {
      orders: [{ id: "ord-1", customerId: "cust-1", totalUsd: 500, commissionUsd: 50 }],
      payments: [],
      fees: [],
      allocations: [],
      audit: [],
    };
    const baseline = computeInMemoryBalances(beforePayment, "cust-1");
    assert.equal(baseline.openDebtUsd, 500);
    assert.equal(baseline.feeBalanceUsd, 50);

    const afterIntake: InMemoryLedgerStore = {
      orders: beforePayment.orders,
      payments: [
        pay({ id: "pay-1", amountUsd: 500 }),
        pay({
          id: "fee-pay-1",
          businessType: "ADJUSTMENT_FEE",
          amountUsd: 100,
          orderId: null,
          paymentCode: null,
        }),
      ],
      fees: [
        {
          id: "fee-1",
          customerId: "cust-1",
          paymentId: "fee-pay-1",
          paymentCaptureCode: "TR-P-000100",
          status: "OPEN",
          amountUsd: 100,
        },
      ],
      allocations: [
        { id: "a1", paymentId: "pay-1", method: "CASH", amountUsd: 200 },
        { id: "a2", paymentId: "pay-1", method: "BANK_TRANSFER", amountUsd: 300 },
      ],
      audit: [],
    };
    const mid = computeInMemoryBalances(afterIntake, "cust-1");
    assert.equal(mid.openDebtUsd, 0);
    assert.equal(mid.feeBalanceUsd, 150);

    const { store } = applyInMemoryCancellation(afterIntake, "pay-1");
    const end = computeInMemoryBalances(store, "cust-1");
    assert.deepEqual(end, baseline);
    assert.equal(store.payments.every((p) => p.status === "CANCELLED"), true);
    assert.equal(store.fees[0]?.status, "CANCELLED");
    assert.equal(store.allocations.length, 2);
    assert.equal(store.audit.length, 1);
    assert.deepEqual(scanPaymentCancellationIntegrity(store), []);

    const cashControlActiveUsd = store.payments
      .filter((p) => p.status === "ACTIVE" && p.businessType === "STANDARD")
      .reduce((s, p) => s + p.amountUsd, 0);
    const ledgerVisibleCancelled = store.payments.filter((p) => p.status === "CANCELLED").length;
    const commissionPopover = store.fees.filter((f) => f.status !== "CANCELLED").reduce((s, f) => s + f.amountUsd, 0);
    assert.equal(cashControlActiveUsd, 0);
    assert.equal(ledgerVisibleCancelled, 2);
    assert.equal(50 + commissionPopover, baseline.feeBalanceUsd);
  });
});
