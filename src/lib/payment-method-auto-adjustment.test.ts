import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPlannedBreakdownPreserved,
  buildAdjustedBreakdownForOrder,
  buildPaymentMethodAdjustmentBootstrap,
  buildPaymentMethodAutoAdjustmentPreview,
  plannedBreakdownTotalAmount,
  plannedBreakdownWasWiped,
  verifyPlannedBreakdownAfterAdjustment,
} from "@/lib/payment-method-auto-adjustment";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

function order(params: {
  id: string;
  orderNumber: string;
  dateYmd: string;
  cashRemainingUsd: number;
  extraBreakdown?: Array<{ method: string; planned: number; remaining: number; currency?: "USD" | "ILS" }>;
}): PaymentIntakeOrderRow {
  const totalUsd = params.cashRemainingUsd + (params.extraBreakdown?.reduce((sum, row) => sum + row.planned, 0) ?? 0);
  return {
    id: params.id,
    orderNumber: params.orderNumber,
    paymentCode: null,
    dateYmd: params.dateYmd,
    week: "AH-136",
    rate: "1",
    amountUsd: totalUsd.toFixed(2),
    commissionUsd: "0.00",
    totalIls: totalUsd.toFixed(2),
    totalAmountUsd: totalUsd.toFixed(2),
    dbPaidUsd: "0.00",
    dbRemainingUsd: totalUsd.toFixed(2),
    status: "unpaid",
    lastPaymentDateYmd: null,
    sourceCountry: null,
    isComposite: true,
    breakdown: [
      {
        method: "CASH",
        label: "מזומן",
        currency: "USD",
        planned: params.cashRemainingUsd,
        paid: 0,
        remaining: params.cashRemainingUsd,
        plannedUsd: params.cashRemainingUsd,
        paidUsd: 0,
        remainingUsd: params.cashRemainingUsd,
      },
      ...(params.extraBreakdown ?? []).map((row) => ({
        method: row.method,
        label: row.method,
        currency: row.currency ?? "USD",
        planned: row.planned,
        paid: row.planned - row.remaining,
        remaining: row.remaining,
        plannedUsd: row.planned,
        paidUsd: row.planned - row.remaining,
        remainingUsd: row.remaining,
      })),
    ],
    actualMethods: [],
    hasMethodDeviation: false,
    paymentPlan: null,
  };
}

test("auto-adjustment uses FIFO oldest to newest", () => {
  const result = buildPaymentMethodAutoAdjustmentPreview({
    orders: [
      order({ id: "2", orderNumber: "TR-2", dateYmd: "2026-08-02", cashRemainingUsd: 200 }),
      order({ id: "1", orderNumber: "TR-1", dateYmd: "2026-08-01", cashRemainingUsd: 100 }),
    ],
    fromMethod: "CASH",
    toMethod: "BANK_TRANSFER",
    amountUsd: 250,
    customerOpenDebtUsd: 300,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.preview.affectedOrders.map((row) => [row.orderNumber, row.moveUsd]),
    [
      ["TR-1", 100],
      ["TR-2", 150],
    ],
  );
});

test("auto-adjustment partially updates the last order to hit exact target", () => {
  const result = buildPaymentMethodAutoAdjustmentPreview({
    orders: [
      order({ id: "a", orderNumber: "TR-136-0005", dateYmd: "2026-08-01", cashRemainingUsd: 1515 }),
      order({ id: "b", orderNumber: "TR-136-0006", dateYmd: "2026-08-02", cashRemainingUsd: 2525 }),
      order({ id: "c", orderNumber: "TR-136-0007", dateYmd: "2026-08-03", cashRemainingUsd: 10000 }),
    ],
    fromMethod: "CASH",
    toMethod: "BANK_TRANSFER",
    amountUsd: 6000,
    customerOpenDebtUsd: 14040,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const last = result.preview.affectedOrders.at(-1);
  assert.ok(last);
  assert.equal(last.moveUsd, 1960);
  const cashLine = last.afterBreakdown.find((line) => line.paymentMethod === "CASH");
  const transferLine = last.afterBreakdown.find((line) => line.paymentMethod === "BANK_TRANSFER");
  assert.equal(cashLine?.amount, "8040.00");
  assert.equal(transferLine?.amount, "1960.00");
  assert.equal(result.preview.afterFromOpenUsd, 8040);
  assert.equal(result.preview.afterToOpenUsd, 6000);
});

test("preview uses injected SSOT debt, not Σ dbRemainingUsd", () => {
  const result = buildPaymentMethodAutoAdjustmentPreview({
    orders: [
      order({ id: "1", orderNumber: "TR-1", dateYmd: "2026-08-01", cashRemainingUsd: 400 }),
    ],
    fromMethod: "CASH",
    toMethod: "BANK_TRANSFER",
    amountUsd: 100,
    customerOpenDebtUsd: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.preview.customerOpenDebtUsd, 0);
  assert.equal(result.preview.affectedOrders.length, 1);
  assert.equal(result.preview.affectedOrders[0]!.moveUsd, 100);
});

test("bootstrap does not treat Σ order remaining as customer open debt", () => {
  const bootstrap = buildPaymentMethodAdjustmentBootstrap({
    orders: [
      order({ id: "1", orderNumber: "TR-1", dateYmd: "2026-08-01", cashRemainingUsd: 400 }),
    ],
    customerPayments: [],
  });
  assert.equal("customerOpenDebtUsd" in bootstrap, false);
});

test("auto-adjustment reallocates planned methods and never wipes them", () => {
  const source = order({
    id: "tr-140-0001",
    orderNumber: "TR-140-0001",
    dateYmd: "2026-09-01",
    cashRemainingUsd: 500,
    extraBreakdown: [{ method: "BANK_TRANSFER", planned: 300, remaining: 300 }],
  });
  const before = [
    { paymentMethod: "CASH", amount: "500.00", currency: "USD" as const },
    { paymentMethod: "BANK_TRANSFER", amount: "300.00", currency: "USD" as const },
  ];
  const after = buildAdjustedBreakdownForOrder({
    order: source,
    fromMethod: "CASH",
    toMethod: "BANK_TRANSFER",
    moveUsd: 85,
  });
  assert.equal(plannedBreakdownWasWiped(before, after), false);
  assert.ok(after.length >= 1);
  assert.equal(plannedBreakdownTotalAmount(after), 800);
  assert.throws(() => assertPlannedBreakdownPreserved(before, []));
  const verified = verifyPlannedBreakdownAfterAdjustment({
    orderId: source.id,
    orderNumber: "TR-140-0001",
    before,
    expected: after,
    afterDb: after,
  });
  assert.equal(verified.match, true);
  assert.equal(
    verifyPlannedBreakdownAfterAdjustment({
      orderId: source.id,
      orderNumber: "TR-140-0001",
      before,
      expected: after,
      afterDb: before,
    }).match,
    false,
  );
});
