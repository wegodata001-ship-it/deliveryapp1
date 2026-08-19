import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDualCurrencyMatching,
  applyPaymentMethodMatching,
  type MethodBalanceRow,
} from "@/lib/payment-method-matching-engine";

function bal(
  partial: Omit<MethodBalanceRow, "status" | "label"> & {
    label?: string;
    status?: MethodBalanceRow["status"];
  },
): MethodBalanceRow {
  return {
    label: partial.label ?? partial.method,
    status: partial.status ?? "open",
    ...partial,
  };
}

describe("Matching Engine — הפרדת מטבעות", () => {
  it("USD בלבד — מזומן $2000 נסגר בדולר", () => {
    const result = applyPaymentMethodMatching({
      currency: "USD",
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 2000,
          paid: 0,
          remaining: 2000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    const cash = result.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!;
    assert.equal(cash.paid, 2000);
    assert.equal(cash.remaining, 0);
    assert.equal(result.surplus, 0);
  });

  it("ILS בלבד — העברה ₪10000 נסגרת בשקל; תשלום USD לא נוגע", () => {
    const result = applyPaymentMethodMatching({
      currency: "ILS",
      balances: [
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 10000,
          paid: 0,
          remaining: 10000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    const bank = result.balances.find((b) => b.currency === "ILS")!;
    assert.equal(bank.paid, 10000);
    assert.equal(bank.remaining, 0);
    assert.equal(result.surplus, 0);
  });

  it("דולר + שקל — כל מטבע עצמאי; אין קיזוז צולב", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 2000,
          paid: 0,
          remaining: 2000,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 10000,
          paid: 0,
          remaining: 10000,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 2000 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 10000 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3.5]]),
    });

    const cash = dual.balances.find((b) => b.currency === "USD")!;
    const bank = dual.balances.find((b) => b.currency === "ILS")!;
    assert.equal(cash.paid, 2000);
    assert.equal(cash.remaining, 0);
    assert.equal(bank.paid, 10000);
    assert.equal(bank.remaining, 0);
    assert.equal(dual.surplusUsd, 0);
    assert.equal(dual.surplusIls, 0);
  });

  it("עודף USD לא משפיע על ILS", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 500,
          paid: 0,
          remaining: 500,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 130 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 500 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    assert.equal(dual.surplusUsd, 30);
    assert.equal(dual.surplusIls, 0);
    assert.equal(dual.balances.find((b) => b.currency === "ILS")!.remaining, 0);
  });

  it("עודף ILS לא משפיע על USD", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 500,
          paid: 0,
          remaining: 500,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 100 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 550 },
      ],
      orderIdsOldestFirst: ["o1"],
    });
    assert.equal(dual.surplusUsd, 0);
    assert.equal(dual.surplusIls, 50);
    assert.equal(dual.balances.find((b) => b.currency === "USD")!.remaining, 0);
  });

  it("העברת חוב רק בתוך אותו מטבע — העברה USD→ILS נדחית", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "1",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "2",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "ILS",
          planned: 400,
          paid: 0,
          remaining: 400,
        }),
      ],
      enteredByBucket: [],
      orderIdsOldestFirst: ["o1"],
      debtTransfers: [
        {
          fromBucket: "CASH",
          toBucket: "BANK_TRANSFER",
          amount: 100,
          currency: "USD",
        },
      ],
    });
    // העברה בתוך USD: cash remaining יורד; שורת BANK ב-USD נוצרת — לא נוגעת ב-ILS
    const cashUsd = dual.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!;
    const bankIls = dual.balances.find((b) => b.currency === "ILS")!;
    assert.equal(cashUsd.remaining, 0);
    assert.equal(bankIls.remaining, 400);
    assert.ok(dual.transfersApplied.every((t) => t.currency === "USD"));
  });
});

describe("Matching Engine — קליטת ILS מול חוב USD", () => {
  const orderCashUsd = (remaining: number, paid = 0): MethodBalanceRow =>
    bal({
      breakdownId: "cash-usd",
      orderId: "o1",
      method: "CASH",
      bucket: "CASH",
      currency: "USD",
      planned: 100,
      paid,
      remaining,
    });

  it("Acceptance: הזמנה $100, מזומן ₪100 @3 → applied $33.33, יתרה $66.67", () => {
    const dual = applyDualCurrencyMatching({
      balances: [orderCashUsd(100)],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "ILS", entered: 100 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3]]),
    });

    const cash = dual.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!;
    assert.equal(cash.paid, 33.33);
    assert.equal(cash.remaining, 66.67);
    assert.equal(dual.amountUsdByOrderId.get("o1"), 33.33);
    assert.equal(dual.appliedLines.length, 1);
    assert.equal(dual.appliedLines[0]!.currency, "ILS");
    assert.equal(dual.appliedLines[0]!.amount, 100);
    assert.equal(dual.surplusIls, 0);
  });

  it("Acceptance: אחרי ₪100, תשלום $66.67 USD — חוב נסגר", () => {
    const dual = applyDualCurrencyMatching({
      balances: [orderCashUsd(66.67, 33.33)],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 66.67 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3]]),
    });

    const cash = dual.balances.find((b) => b.currency === "USD" && b.bucket === "CASH")!;
    assert.equal(cash.remaining, 0);
    assert.equal(dual.amountUsdByOrderId.get("o1"), 66.67);
  });

  it("Acceptance: CASH $100 + BANK $100 — CASH ₪300 + BANK ₪300 @3 → $100 per method", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "cash",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "bank",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "ILS", entered: 300 },
        { bucket: "BANK_TRANSFER", label: "העברה", currency: "ILS", entered: 300 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3]]),
    });

    const cash = dual.balances.find((b) => b.bucket === "CASH")!;
    const bank = dual.balances.find((b) => b.bucket === "BANK_TRANSFER")!;
    assert.equal(cash.paid, 100);
    assert.equal(cash.remaining, 0);
    assert.equal(bank.paid, 100);
    assert.equal(bank.remaining, 0);
    assert.equal(dual.amountUsdByOrderId.get("o1"), 200);
    assert.equal(dual.surplusIls, 0);
  });

  it("Acceptance: CASH ₪600 @3 on CASH $100 + BANK $100 — CASH capped, BANK open, surplus ₪300", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "cash",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "bank",
          orderId: "o1",
          method: "BANK_TRANSFER",
          bucket: "BANK_TRANSFER",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "ILS", entered: 600 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3]]),
    });

    const cash = dual.balances.find((b) => b.bucket === "CASH")!;
    const bank = dual.balances.find((b) => b.bucket === "BANK_TRANSFER")!;
    assert.equal(cash.paid, 100);
    assert.equal(cash.remaining, 0);
    assert.equal(bank.paid, 0);
    assert.equal(bank.remaining, 100);
    assert.equal(dual.amountUsdByOrderId.get("o1"), 100);
    assert.equal(dual.surplusIls, 300);
  });

  it("תשלום מורכב: ₪150+₪300 מזומן/אשראי + $50 מזומן @3 → $200", () => {
    const dual = applyDualCurrencyMatching({
      balances: [
        bal({
          breakdownId: "c",
          orderId: "o1",
          method: "CASH",
          bucket: "CASH",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
        bal({
          breakdownId: "cr",
          orderId: "o1",
          method: "CREDIT",
          bucket: "CREDIT",
          currency: "USD",
          planned: 100,
          paid: 0,
          remaining: 100,
        }),
      ],
      enteredByBucket: [
        { bucket: "CASH", label: "מזומן", currency: "ILS", entered: 150 },
        { bucket: "CREDIT", label: "אשראי", currency: "ILS", entered: 300 },
        { bucket: "CASH", label: "מזומן", currency: "USD", entered: 50 },
      ],
      orderIdsOldestFirst: ["o1"],
      rateByOrderId: new Map([["o1", 3]]),
    });

    assert.equal(dual.amountUsdByOrderId.get("o1"), 200);
    const cashUsd = dual.balances.find((b) => b.bucket === "CASH")!;
    const creditUsd = dual.balances.find((b) => b.bucket === "CREDIT")!;
    assert.equal(cashUsd.remaining, 0);
    assert.equal(creditUsd.remaining, 0);
    assert.equal(
      dual.appliedLines.filter((l) => l.currency === "ILS" && l.bucket === "CASH")[0]?.amount,
      150,
    );
    assert.equal(
      dual.appliedLines.filter((l) => l.currency === "ILS" && l.bucket === "CREDIT")[0]?.amount,
      300,
    );
    assert.equal(
      dual.appliedLines.filter((l) => l.currency === "USD" && l.bucket === "CASH")[0]?.amount,
      50,
    );
  });
});
