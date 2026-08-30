import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  intentsFromDraftPaymentLines,
  planPaymentIntentAdjustments,
} from "@/lib/payment-method-payment-intent";
import type { PaymentIntakeOrderRow } from "@/lib/payment-intake";

function order(partial: {
  id: string;
  orderNumber: string;
  dateYmd: string;
  remainingUsd: number;
  method?: string;
}): PaymentIntakeOrderRow {
  const rem = partial.remainingUsd;
  return {
    id: partial.id,
    orderNumber: partial.orderNumber,
    dateYmd: partial.dateYmd,
    amountUsd: String(rem),
    commissionUsd: "0",
    totalAmountUsd: String(rem),
    dbPaidUsd: "0",
    dbRemainingUsd: String(rem),
    paymentMethod: partial.method ?? "CASH",
    rate: "3",
    breakdown: [
      {
        method: partial.method ?? "CASH",
        label: "מזומן",
        currency: "USD",
        planned: rem,
        plannedUsd: rem,
        paid: 0,
        paidUsd: 0,
        remaining: rem,
        remainingUsd: rem,
      },
    ],
  } as unknown as PaymentIntakeOrderRow;
}

describe("planPaymentIntentAdjustments", () => {
  it("FIFO מזומן→העברה לפי תשלום ILS מנורמל", () => {
    const orders = [
      order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 2000 }),
      order({ id: "b", orderNumber: "TR-2", dateYmd: "2026-08-02", remainingUsd: 3000 }),
      order({ id: "c", orderNumber: "TR-3", dateYmd: "2026-08-03", remainingUsd: 4000 }),
    ];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [{ method: "BANK_TRANSFER", currency: "ILS", amountNative: 20000 }],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.totalPayUsd, 6666.67);
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.moves[0]!.fromMethod, "CASH");
    assert.equal(plan.moves[0]!.toMethod, "BANK_TRANSFER");
    assert.equal(plan.moves[0]!.amountUsd, 6666.67);
    assert.equal(plan.orderChanges.length, 3);
    assert.equal(plan.orderChanges[0]!.moveUsd, 2000);
    assert.equal(plan.orderChanges[1]!.moveUsd, 3000);
    assert.equal(plan.orderChanges[2]!.moveUsd, 1666.67);
    assert.equal(plan.orderChanges[2]!.partial, true);
  });

  it("תשלום מורכב — רק החלק שלא תואם דורש התאמה", () => {
    const orders = [
      order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 2000 }),
      order({ id: "b", orderNumber: "TR-2", dateYmd: "2026-08-02", remainingUsd: 3000 }),
      order({ id: "c", orderNumber: "TR-3", dateYmd: "2026-08-03", remainingUsd: 4000 }),
    ];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [
        { method: "CASH", currency: "USD", amountNative: 2000 },
        { method: "BANK_TRANSFER", currency: "ILS", amountNative: 9000 },
      ],
      exchangeRate: 3,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.totalPayUsd, 5000);
    assert.equal(plan.moves[0]!.amountUsd, 3000);
    assert.equal(plan.moves[0]!.toMethod, "BANK_TRANSFER");
  });

  it("דוחה תשלום מעל החוב הפתוח", () => {
    const orders = [order({ id: "a", orderNumber: "TR-1", dateYmd: "2026-08-01", remainingUsd: 100 })];
    const plan = planPaymentIntentAdjustments({
      orders,
      intents: [{ method: "CASH", currency: "USD", amountNative: 500 }],
    });
    assert.equal(plan.ok, false);
  });
});

describe("intentsFromDraftPaymentLines", () => {
  it("מאגד טיוטת תשלום דו-מטבעית", () => {
    const intents = intentsFromDraftPaymentLines([
      {
        usdAmount: 2000,
        ilsAmount: 9000,
        usdPaymentMethod: "CASH",
        ilsPaymentMethod: "BANK_TRANSFER",
      },
    ]);
    assert.equal(intents.length, 2);
    assert.ok(intents.some((i) => i.method === "CASH" && i.currency === "USD" && i.amountNative === 2000));
    assert.ok(
      intents.some((i) => i.method === "BANK_TRANSFER" && i.currency === "ILS" && i.amountNative === 9000),
    );
  });
});
