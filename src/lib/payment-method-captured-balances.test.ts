import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCapturedPaymentsByMethodCurrency,
  suggestPaymentMethodAdjustment,
} from "@/lib/payment-method-captured-balances";

describe("payment-method-captured-balances", () => {
  it("מסכם תשלומים לפי אמצעי ומטבע — ללא המרה", () => {
    const rows = aggregateCapturedPaymentsByMethodCurrency([
      { amountUsd: "20000", amountIls: null, exchangeRate: "3.5", paymentMethod: "CASH", usdPaymentMethod: "CASH", ilsPaymentMethod: null },
      { amountUsd: "15000", amountIls: null, exchangeRate: "3.5", paymentMethod: "CASH", usdPaymentMethod: "CASH", ilsPaymentMethod: null },
      { amountUsd: null, amountIls: "12500", exchangeRate: "3.5", paymentMethod: "CASH", usdPaymentMethod: null, ilsPaymentMethod: "CASH" },
      { amountUsd: "8000", amountIls: null, exchangeRate: "3.5", paymentMethod: "BANK_TRANSFER", usdPaymentMethod: "BANK_TRANSFER", ilsPaymentMethod: null },
      { amountUsd: null, amountIls: "24000", exchangeRate: "3.5", paymentMethod: "BANK_TRANSFER", usdPaymentMethod: null, ilsPaymentMethod: "BANK_TRANSFER" },
    ]);

    const cashUsd = rows.find((r) => r.methodKey === "CASH" && r.currency === "USD")?.amount;
    const cashIls = rows.find((r) => r.methodKey === "CASH" && r.currency === "ILS")?.amount;
    const bankUsd = rows.find((r) => r.methodKey === "BANK_TRANSFER" && r.currency === "USD")?.amount;
    const bankIls = rows.find((r) => r.methodKey === "BANK_TRANSFER" && r.currency === "ILS")?.amount;

    assert.equal(cashUsd, 35000);
    assert.equal(cashIls, 12500);
    assert.equal(bankUsd, 8000);
    assert.equal(bankIls, 24000);
  });

  it("מציע התאמה CASH→BANK USD לפי פער בין נקלט לבין מתוכנן", () => {
    const captured = aggregateCapturedPaymentsByMethodCurrency([
      { amountUsd: "35000", amountIls: null, exchangeRate: null, paymentMethod: "CASH", usdPaymentMethod: "CASH", ilsPaymentMethod: null },
      { amountUsd: "8000", amountIls: null, exchangeRate: null, paymentMethod: "BANK_TRANSFER", usdPaymentMethod: "BANK_TRANSFER", ilsPaymentMethod: null },
    ]);
    const planned = [
      { methodKey: "CASH" as const, methodLabel: "מזומן", currency: "USD" as const, amount: 20000 },
      { methodKey: "BANK_TRANSFER" as const, methodLabel: "העברה", currency: "USD" as const, amount: 23000 },
    ];
    const suggestion = suggestPaymentMethodAdjustment({
      captured,
      planned,
      fromMethod: "CASH",
      toMethod: "BANK_TRANSFER",
      currency: "USD",
    });
    assert.ok(suggestion);
    assert.equal(suggestion.amount, 15000);
    assert.equal(suggestion.currency, "USD");
  });
});
