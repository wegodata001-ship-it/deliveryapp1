import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBankPsTransferIls,
  computeCashDrawerIlsAfterPsFx,
  computeIlFxPurchaseIls,
  computeIlsRemainingAfterFx,
  computeBankBalanceAfterIlFx,
  computeTurkeyAllocationFromCashCount,
  computeTurkeyIlAllocationIls,
} from "@/lib/flow-control/flow-calculation-service";

describe("PS Turkey + IL FX formulas", () => {
  it("Turkey PS available = cash USD in drawer + FX bought (fee is separate)", () => {
    assert.equal(computeTurkeyAllocationFromCashCount(100, 50, 5), 150);
    assert.equal(computeTurkeyAllocationFromCashCount(0, 80, 2.5), 80);
    assert.equal(computeTurkeyAllocationFromCashCount(999, 0, 0), 999);
    assert.equal(computeTurkeyAllocationFromCashCount(0, 0, 0), 0);
  });

  it("Turkey IL available = FX IL only (fee is separate)", () => {
    assert.equal(computeTurkeyIlAllocationIls(150, 10), 150);
    assert.equal(computeTurkeyIlAllocationIls(0, 5), 0);
    assert.equal(computeTurkeyIlAllocationIls(0, 0), 0);
  });

  it("IL FX purchase = transfer + credit + checks", () => {
    assert.equal(computeIlFxPurchaseIls(100, 20, 30), 150);
    assert.equal(computeIlFxPurchaseIls(0, 0, 0), 0);
    assert.equal(computeIlFxPurchaseIls(-1, 10, 5), 15);
    assert.equal(computeBankPsTransferIls(100, 20, 30), 150);
  });

  it("ILS remaining = receipts − FX PS − FX IL (= available for FX modal)", () => {
    assert.equal(computeIlsRemainingAfterFx(1000, 300, 200), 500);
    assert.equal(computeIlsRemainingAfterFx(100, 80, 40), -20);
    assert.equal(computeIlsRemainingAfterFx(5000, 0, 0), 5000);
  });

  it("Cash drawer = PS cash − expenses − FX PS", () => {
    assert.equal(computeCashDrawerIlsAfterPsFx(500, 50, 200), 250);
    assert.equal(computeCashDrawerIlsAfterPsFx(100, 0, 0), 100);
  });

  it("Bank balance = bank receipts − IL FX − withdrawals + deposits", () => {
    assert.equal(computeBankBalanceAfterIlFx(800, 300, 50, 20), 470);
    assert.equal(computeBankBalanceAfterIlFx(200, 200), 0);
  });
});
