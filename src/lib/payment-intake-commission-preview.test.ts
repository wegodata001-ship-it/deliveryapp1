import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionDeltaAlreadyAppliedUsd,
  computePaymentIntakeCommissionDisplayUsd,
  previewCommissionAfterDebtResetUsd,
} from "@/lib/payment-intake-commission-preview";

describe("computePaymentIntakeCommissionDisplayUsd", () => {
  it("עמלה לפני $15 + הוספה $17 = $32", () => {
    const v = computePaymentIntakeCommissionDisplayUsd({
      serverCommissionBalanceUsd: 15,
      pendingDebitFromCommissionUsd: 0,
      pendingCreditToCommissionUsd: 17,
    });
    assert.equal(v, 32);
  });

  it("איפוס מהעמלה $7 — עמלה $32 → $25", () => {
    const v = computePaymentIntakeCommissionDisplayUsd({
      serverCommissionBalanceUsd: 32,
      pendingDebitFromCommissionUsd: 7,
      pendingCreditToCommissionUsd: 0,
    });
    assert.equal(v, 25);
  });

  it("אין מספיק עמלה — עמלה יכולה להיות שלילית", () => {
    const v = computePaymentIntakeCommissionDisplayUsd({
      serverCommissionBalanceUsd: 5,
      pendingDebitFromCommissionUsd: 10,
      pendingCreditToCommissionUsd: 0,
    });
    assert.equal(v, -5);
  });
});

describe("previewCommissionAfterDebtResetUsd", () => {
  it("מאפס חוב $7 מעמלה $32 → $25", () => {
    assert.equal(previewCommissionAfterDebtResetUsd(7, 32), 25);
  });
});

describe("commissionDeltaAlreadyAppliedUsd", () => {
  it("תשlום היסטורי — לא מוסיפים שוב $17", () => {
    assert.equal(commissionDeltaAlreadyAppliedUsd(17, 17), 0);
  });

  it("עריכה — רק delta", () => {
    assert.equal(commissionDeltaAlreadyAppliedUsd(17, 20), 3);
  });
});
