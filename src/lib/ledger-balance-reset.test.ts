import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentOverpayment } from "@/lib/payment-overpayment";
import { resultingCustomerCreditUsd } from "@/lib/payment-method-payment-intent";
import {
  buildCustomerBalanceResetLedgerDraft,
  DIRECT_RESET_SOURCE,
  isLedgerVisibleCodedFeePayment,
  paymentIntakeDebtCreditStrip,
  shouldSkipLedgerPaymentBatchRow,
} from "@/lib/ledger-balance-reset";

describe("ledger fee visibility", () => {
  it("shows ADJUSTMENT_FEE only when it has a paymentCode", () => {
    assert.equal(
      isLedgerVisibleCodedFeePayment({ businessType: "ADJUSTMENT_FEE", paymentCode: "TR-P-000009" }),
      true,
    );
    assert.equal(
      isLedgerVisibleCodedFeePayment({ businessType: "ADJUSTMENT_FEE", paymentCode: null }),
      false,
    );
    assert.equal(
      shouldSkipLedgerPaymentBatchRow({ businessType: "ADJUSTMENT_FEE", paymentCode: "TR-P-000009" }),
      false,
    );
    assert.equal(
      shouldSkipLedgerPaymentBatchRow({ businessType: "ADJUSTMENT_FEE", paymentCode: null }),
      true,
    );
  });

  it("does not drop a regular STANDARD capture", () => {
    assert.equal(
      shouldSkipLedgerPaymentBatchRow({ businessType: "STANDARD", paymentCode: "TR-P-000008" }),
      false,
    );
  });
});

describe("paymentIntakeDebtCreditStrip", () => {
  it("never hides credit when open debt is $0", () => {
    const strip = paymentIntakeDebtCreditStrip({ openDebtUsd: 0, creditBalanceUsd: 15 });
    assert.equal(strip.openDebtUsd, 0);
    assert.equal(strip.creditBalanceUsd, 15);
  });

  it("never uses negative debt as credit", () => {
    const strip = paymentIntakeDebtCreditStrip({ openDebtUsd: -150, creditBalanceUsd: 150 });
    assert.equal(strip.openDebtUsd, 0);
    assert.equal(strip.creditBalanceUsd, 150);
  });

  it("shows both fields when both exist", () => {
    const strip = paymentIntakeDebtCreditStrip({ openDebtUsd: 200, creditBalanceUsd: 50 });
    assert.equal(strip.openDebtUsd, 200);
    assert.equal(strip.creditBalanceUsd, 50);
  });
});

describe("BALANCE_RESET ledger draft", () => {
  it("builds a dedicated איפוס יתרה row from CUSTOMER_BALANCES_RESET", () => {
    const createdAt = new Date("2026-08-28T12:00:00.000Z");
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: "audit-1",
      createdAt,
      userId: "user-1",
      metadata: {
        ledgerLabel: "איפוס יתרה",
        source: DIRECT_RESET_SOURCE,
        amountBeforeUsd: "50.00",
        amountResetUsd: "50.00",
        amountAfterUsd: "0.00",
        performedBy: "user-1",
        performedAt: createdAt.toISOString(),
        totalResetUsd: "50.00",
        closedOrders: [
          {
            orderId: "ord-1",
            remainingUsd: "50.00",
            adjustmentType: "SHORTFALL",
            balanceBeforeUsd: "50.00",
          },
        ],
      },
      oldValue: { totalRemainingUsd: "50" },
      newValue: { totalResetUsd: "50" },
    });
    assert.equal(draft.typeLabel, "איפוס יתרה");
    assert.equal(draft.displayPaymentUsd, "50.00");
    assert.equal(draft.affectsRunningBalance, true);
    assert.equal(draft.detail.source, DIRECT_RESET_SOURCE);
    assert.equal(draft.detail.amountBeforeUsd, "50.00");
    assert.equal(draft.detail.amountAfterUsd, "0.00");
    assert.equal(draft.detail.resetKind, "DEBT");
  });

  it("credit reset is visible but does not change running balance", () => {
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: "audit-credit",
      createdAt: new Date("2026-08-28T15:00:00.000Z"),
      metadata: {
        source: DIRECT_RESET_SOURCE,
        resetKind: "CREDIT",
        amountBeforeUsd: "50.00",
        amountResetUsd: "50.00",
        amountAfterUsd: "0.00",
        creditPaymentIds: ["cred-1"],
        totalResetUsd: "50.00",
      },
    });
    assert.equal(draft.typeLabel, "איפוס יתרה");
    assert.equal(draft.displayPaymentUsd, "50.00");
    assert.equal(draft.affectsRunningBalance, false);
    assert.equal(draft.paymentUsdForBalance, "0.00");
    assert.equal(draft.detail.resetKind, "CREDIT");
  });

  it("uses metadata ledgerLabel for balances-screen debt reset", () => {
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: "audit-balances",
      createdAt: new Date("2026-09-02T10:00:00.000Z"),
      metadata: {
        ledgerLabel: "איפוס חוב מעמלות",
        source: DIRECT_RESET_SOURCE,
        resetKind: "DEBT",
        amountResetUsd: "20.00",
        openDebtBeforeUsd: "20.00",
        openDebtAfterUsd: "0.00",
        commissionBeforeUsd: "100.00",
        commissionAfterUsd: "80.00",
        closedOrders: [{ orderId: "o1", remainingUsd: "20.00", adjustmentType: "SHORTFALL" }],
      },
    });
    assert.equal(draft.typeLabel, "איפוס חוב מעמלות");
    assert.equal(draft.detail.commissionBeforeUsd, "100.00");
    assert.equal(draft.detail.commissionAfterUsd, "80.00");
  });

  it("still emits a row when closedOrders is empty (credit-only / failed-open-debt)", () => {
    const draft = buildCustomerBalanceResetLedgerDraft({
      logId: "audit-empty",
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
      metadata: {
        source: DIRECT_RESET_SOURCE,
        resetKind: "CREDIT",
        amountBeforeUsd: "15.00",
        amountResetUsd: "15.00",
        amountAfterUsd: "0.00",
        totalResetUsd: "15.00",
      },
    });
    assert.equal(draft.document, "איפוס יתרה");
    assert.equal(draft.detail.amountBeforeUsd, "15.00");
  });
});

describe("overpay then reopen intake — credit remains visible", () => {
  it("debt $500 → $300 → $250 leaves credit $50 for the next intake strip", () => {
    const first = computePaymentOverpayment(500, 300);
    assert.equal(first.closesDebtUsd, 300);
    assert.equal(first.overpaymentUsd, 0);
    const leftover = 500 - first.closesDebtUsd;
    assert.equal(leftover, 200);

    const second = computePaymentOverpayment(leftover, 250);
    assert.equal(second.closesDebtUsd, 200);
    assert.equal(second.overpaymentUsd, 50);
    assert.equal(second.hasOverpayment, true);

    const credit = resultingCustomerCreditUsd(0, second.overpaymentUsd);
    assert.equal(credit, 50);

    const strip = paymentIntakeDebtCreditStrip({ openDebtUsd: 0, creditBalanceUsd: credit });
    assert.equal(strip.openDebtUsd, 0);
    assert.equal(strip.creditBalanceUsd, 50);
  });

  it("direct reset after credit $50 is a separate movement; historical payments stay", () => {
    const payments = [
      { paymentId: "p1", amountUsd: 300 },
      { paymentId: "p2", amountUsd: 250 },
    ];
    const reset = buildCustomerBalanceResetLedgerDraft({
      logId: "reset-after-credit",
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
      metadata: {
        source: DIRECT_RESET_SOURCE,
        resetKind: "CREDIT",
        amountBeforeUsd: "50.00",
        amountResetUsd: "50.00",
        amountAfterUsd: "0.00",
        creditPaymentIds: ["credit-sibling"],
      },
    });
    assert.equal(payments.length, 2);
    assert.equal(payments[0]!.amountUsd, 300);
    assert.equal(payments[1]!.amountUsd, 250);
    assert.equal(reset.typeLabel, "איפוס יתרה");
    assert.notEqual(reset.id, payments[0]!.paymentId);
    assert.notEqual(reset.id, payments[1]!.paymentId);
  });
});
