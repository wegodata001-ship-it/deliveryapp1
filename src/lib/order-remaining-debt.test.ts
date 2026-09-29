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
  computePaymentBalanceUsd,
  deriveOrderPaymentDisplayStatus,
  deriveCustomerAccountBalanceDisplay,
  derivePaymentBalanceDisplay,
  formatPaymentBalanceIlsLine,
  formatPaymentBalanceUsdLine,
  reconcileOrderBreakdownWithLedger,
  collectibleRemainingUsdByOrderId,
  collectibleOpenDebtAfterWithdrawalUsd,
  creditUsdEligibleForOrderFifo,
  virtualCustomerCreditAppliedUsdByOrderId,
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

  it("collectible remaining is FIFO after withdrawal, not running balance", () => {
    const remaining = collectibleRemainingUsdByOrderId(
      [
        { orderId: "TR-137-0004", remainingAfterPaymentsUsd: 703.53 },
        { orderId: "TR-134-0005", remainingAfterPaymentsUsd: 0 },
        { orderId: "TR-134-0011", remainingAfterPaymentsUsd: 508.47 },
      ],
      1212,
    );
    assert.equal(remaining.get("TR-137-0004"), 0);
    assert.equal(remaining.get("TR-134-0005"), 0);
    assert.equal(remaining.get("TR-134-0011"), 0);
    assert.notEqual(8342.6, remaining.get("TR-137-0004"));
  });

  it("customer 101: FIFO credit $1,273.83 leaves $758.01", () => {
    const remaining = collectibleRemainingUsdByOrderId(
      [{ orderId: "101-open", remainingAfterPaymentsUsd: 2031.84 }],
      0,
      1273.83,
    );
    assert.equal(remaining.get("101-open"), 758.01);
    assert.equal(collectibleOpenDebtAfterWithdrawalUsd([2031.84], 0, 1273.83), 758.01);
    assert.equal(
      creditUsdEligibleForOrderFifo({
        remainingAfterWithdrawalUsd: 2031.84,
        availableCreditUsd: 1273.83,
      }),
      1273.83,
    );
  });

  it("credit larger than remaining applies only the remaining", () => {
    const remaining = collectibleRemainingUsdByOrderId(
      [{ orderId: "a", remainingAfterPaymentsUsd: 500 }],
      0,
      800,
    );
    assert.equal(remaining.get("a"), 0);
    assert.equal(
      creditUsdEligibleForOrderFifo({ remainingAfterWithdrawalUsd: 500, availableCreditUsd: 800 }),
      500,
    );
  });

  it("FIFO credit across A/B/C: 300+500+400 credit 650 → 0 / 150 / 400", () => {
    const rows = [
      { orderId: "A", remainingAfterPaymentsUsd: 300 },
      { orderId: "B", remainingAfterPaymentsUsd: 500 },
      { orderId: "C", remainingAfterPaymentsUsd: 400 },
    ];
    const remaining = collectibleRemainingUsdByOrderId(rows, 0, 650);
    assert.equal(remaining.get("A"), 0);
    assert.equal(remaining.get("B"), 150);
    assert.equal(remaining.get("C"), 400);
    assert.equal([...remaining.values()].reduce((s, n) => s + n, 0), 550);
    const applied = virtualCustomerCreditAppliedUsdByOrderId(rows, 0, 650);
    assert.equal(applied.get("A"), 300);
    assert.equal(applied.get("B"), 350);
    assert.equal(applied.get("C"), 0);
  });

  it("effective remaining 0 is paid even when total−paid leftover exists", () => {
    assert.equal(
      deriveOrderPaymentDisplayStatus({
        totalUsd: 1212,
        paidUsd: 0,
        effectiveRemainingUsd: 0,
      }),
      "paid",
    );
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

describe("computePaymentBalanceUsd — תצוגת יתרה בקליטה", () => {
  const rate = 3;

  it("$100 debt, $30 paid → remaining $70 + ₪247.80 כולל מע״מ", () => {
    const signed = computePaymentBalanceUsd(100, 30);
    const d = derivePaymentBalanceDisplay(signed, rate);
    assert.equal(d.state, "debt");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "יתרה פתוחה");
    assert.equal(d.displayUsd, 70);
    assert.equal(d.displayIls, 247.8);
  });

  it("$100 debt, $100 paid → cleared", () => {
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(100, 100), rate);
    assert.equal(d.state, "cleared");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "אין יתרה פתוחה");
    assert.equal(d.displayUsd, 0);
    assert.equal(d.displayIls, 0);
  });

  it("$100 debt, $110 paid → surplus +$10 +₪35.40 כולל מע״מ", () => {
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(100, 110), rate);
    assert.equal(d.state, "surplus");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "תשלום יתר");
    assert.equal(d.displayUsd, 10);
    assert.equal(d.displayIls, 35.4);
    assert.equal(formatPaymentBalanceUsdLine(d), "+$10.00");
    assert.equal(formatPaymentBalanceIlsLine(d), "+₪35.40 כולל מע״מ");
  });

  it("customer 101: $758.01 debt, $800 paid → +$41.99 תשלום יתר", () => {
    const signed = computePaymentBalanceUsd(758.01, 800);
    assert.equal(signed, -41.99);
    const d = derivePaymentBalanceDisplay(signed, rate);
    assert.equal(d.state, "surplus");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "תשלום יתר");
    assert.equal(d.displayUsd, 41.99);
    assert.equal(d.balanceUsdSigned, -41.99);
    assert.equal(formatPaymentBalanceUsdLine(d), "+$41.99");
  });

  it("customer 101: $758.01 debt, $500 paid → $258.01 יתרה פתוחה", () => {
    const signed = computePaymentBalanceUsd(758.01, 500);
    assert.equal(signed, 258.01);
    const d = derivePaymentBalanceDisplay(signed, rate);
    assert.equal(d.state, "debt");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "יתרה פתוחה");
    assert.equal(d.displayUsd, 258.01);
    assert.equal(formatPaymentBalanceUsdLine(d), "$258.01");
  });

  it("customer 101: exact $758.01 → אין יתרה פתוחה", () => {
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(758.01, 758.01), rate);
    assert.equal(d.state, "cleared");
    assert.equal(d.statusHint, "אין יתרה פתוחה");
    assert.equal(formatPaymentBalanceUsdLine(d), "$0.00");
  });

  it("$750 debt, $800 paid → +$50.00 תשלום יתר", () => {
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(750, 800), rate);
    assert.equal(d.state, "surplus");
    assert.equal(d.displayUsd, 50);
    assert.equal(formatPaymentBalanceUsdLine(d), "+$50.00");
    assert.equal(d.statusHint, "תשלום יתר");
  });

  it("$100 debt, ₪100 @3 → remaining $66.67", () => {
    const appliedUsd = 33.33;
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(100, appliedUsd), rate);
    assert.equal(d.state, "debt");
    assert.equal(d.displayUsd, 66.67);
    assert.equal(d.displayIls, 236.01);
  });

  it("$100 debt, ₪300 @3 → cleared", () => {
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(100, 100), rate);
    assert.equal(d.state, "cleared");
  });

  it("$100 debt, ₪330 @3 → surplus +$10", () => {
    const appliedUsd = 110;
    const d = derivePaymentBalanceDisplay(computePaymentBalanceUsd(100, appliedUsd), rate);
    assert.equal(d.state, "surplus");
    assert.equal(d.displayUsd, 10);
    assert.equal(d.displayIls, 35.4);
  });
});

describe("deriveCustomerAccountBalanceDisplay — three books", () => {
  const rate = 3;

  it("Khalil: debt 0 credit 1273.83 → יתרת זכות", () => {
    const d = deriveCustomerAccountBalanceDisplay(
      { openDebtUsd: 0, availableCreditUsd: 1273.83 },
      rate,
    );
    assert.equal(d.state, "credit");
    assert.equal(d.title, "יתרת זכות");
    assert.equal(d.displayUsd, 1273.83);
    assert.equal(formatPaymentBalanceUsdLine(d), "+$1,273.83");
  });

  it("Hanan: debt 0 credit 28.05 → יתרת זכות", () => {
    const d = deriveCustomerAccountBalanceDisplay({ openDebtUsd: 0, availableCreditUsd: 28.05 }, rate);
    assert.equal(d.state, "credit");
    assert.equal(formatPaymentBalanceUsdLine(d), "+$28.05");
  });

  it("customer 101: 2031.84 − 1273.83 = 758.01 remaining, not both books", () => {
    const d = deriveCustomerAccountBalanceDisplay(
      { openDebtUsd: 2031.84, availableCreditUsd: 1273.83 },
      rate,
    );
    assert.equal(d.state, "debt");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.displayUsd, 758.01);
  });

  it("Afnan: debt 7362.90 credit 0 → נשאר לתשלום", () => {
    const d = deriveCustomerAccountBalanceDisplay({ openDebtUsd: 7362.9, availableCreditUsd: 0 }, rate);
    assert.equal(d.state, "debt");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.displayUsd, 7362.9);
  });

  it("Kamel / Omar: debt 0 credit 0 → מאוזן, not credit", () => {
    const d = deriveCustomerAccountBalanceDisplay({ openDebtUsd: 0, availableCreditUsd: 0 }, rate);
    assert.equal(d.state, "cleared");
    assert.equal(d.title, "נשאר לתשלום");
    assert.equal(d.statusHint, "מאוזן");
    assert.equal(d.displayUsd, 0);
  });
});
