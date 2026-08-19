import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOpenDebtUsd,
  convertIlsPaymentToUsdCredit,
  convertPaymentInputToUsdCredit,
  convertUsdPaymentToUsdCredit,
} from "@/lib/order-usd-payment-model";

describe("order-usd-payment-model", () => {
  it("Test 1 — full payment in USD", () => {
    const paid = convertUsdPaymentToUsdCredit(120);
    const ledger = computeOpenDebtUsd({ orderId: "t1", totalUsd: 120, paidUsd: paid });
    assert.equal(paid, 120);
    assert.equal(ledger.openDebtUsd, 0);
    assert.equal(ledger.status, "paid");
  });

  it("Test 2 — full payment in ILS", () => {
    const snap = convertPaymentInputToUsdCredit(450, "ILS", 3.75);
    const ledger = computeOpenDebtUsd({ orderId: "t2", totalUsd: 120, paidUsd: snap.amountUsd });
    assert.equal(snap.amountUsd, 120);
    assert.equal(ledger.openDebtUsd, 0);
  });

  it("Test 3 — partial payment in ILS", () => {
    const snap = convertPaymentInputToUsdCredit(225, "ILS", 3.75);
    const ledger = computeOpenDebtUsd({ orderId: "t3", totalUsd: 120, paidUsd: snap.amountUsd });
    assert.equal(snap.amountUsd, 60);
    assert.equal(ledger.paidUsd, 60);
    assert.equal(ledger.openDebtUsd, 60);
    assert.equal(ledger.status, "open");
  });

  it("Test 4 — mixed USD + ILS payments", () => {
    const p1 = convertUsdPaymentToUsdCredit(50);
    const p2 = convertIlsPaymentToUsdCredit(375, 3.75);
    const paid = p1 + p2;
    const ledger = computeOpenDebtUsd({ orderId: "t4", totalUsd: 200, paidUsd: paid });
    assert.equal(paid, 150);
    assert.equal(ledger.openDebtUsd, 50);
  });

  it("Test 5 — rate change does not alter historical payment USD credit", () => {
    const snap = convertPaymentInputToUsdCredit(450, "ILS", 3.75);
    const creditedAtCapture = snap.amountUsd;
    const wronglyRecalculated = convertIlsPaymentToUsdCredit(450, 3.9);
    assert.equal(creditedAtCapture, 120);
    assert.notEqual(creditedAtCapture, wronglyRecalculated);
    const ledger = computeOpenDebtUsd({ orderId: "t5", totalUsd: 120, paidUsd: creditedAtCapture });
    assert.equal(ledger.openDebtUsd, 0);
  });
});
