import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeFxPurchaseFormPreview } from "@/components/admin/manager-count/manager-count-utils";

describe("QA: תצוגת רכישת מט״ח — PS/IL", () => {
  it("10,000 − 5,000 @ 3.20 = $1,562.50 + יתרה 5,000", () => {
    const p = computeFxPurchaseFormPreview(10_000, 5_000, 3.2);
    assert.equal(p.availableIlsBefore, 10_000);
    assert.equal(p.purchaseIls, 5_000);
    assert.equal(p.remainingIlsAfter, 5_000);
    assert.equal(p.purchasedUsd, 1562.5);
  });

  it("רכישה 0 — כל הסכום נשאר בקופה", () => {
    const p = computeFxPurchaseFormPreview(10_000, 0, 3.2);
    assert.equal(p.purchasedUsd, 0);
    assert.equal(p.remainingIlsAfter, 10_000);
    assert.equal(p.purchaseIls, 0);
  });

  it("רכישה 0 — ללא שער", () => {
    const p = computeFxPurchaseFormPreview(10_000, 0, 0);
    assert.equal(p.purchasedUsd, 0);
    assert.equal(Number.isNaN(p.purchasedUsd), false);
  });

  it("purchase > available — remaining שלילי (לולידציה ב-UI)", () => {
    const p = computeFxPurchaseFormPreview(10_000, 11_000, 3.2);
    assert.equal(p.remainingIlsAfter, -1_000);
  });
});
