import test from "node:test";
import assert from "node:assert/strict";
import { buildPaymentMethodAutoAdjustmentPreview } from "@/lib/payment-method-auto-adjustment";
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
