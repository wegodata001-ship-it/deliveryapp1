import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentIntakePostSaveOutcome } from "@/lib/payment-intake-post-save";
import { evaluatePaymentBusinessRules } from "@/lib/payment-business-validation";

describe("Post-save payment intake outcome", () => {
  it("exact payment — no modals", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 0,
      deferredSurplusUsd: 0,
    });
    assert.equal(o.needsSurplusDisposition, false);
    assert.equal(o.needsShortfallResolution, false);
  });

  it("overpayment $7.28 — surplus modal after save", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 0,
      deferredSurplusUsd: 7.28,
    });
    assert.equal(o.needsSurplusDisposition, true);
    assert.equal(o.surplusUsd, 7.28);
    assert.equal(o.needsShortfallResolution, false);
  });

  it("partial payment keeps remaining debt open without correction flow", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 2.72,
      deferredSurplusUsd: 0,
    });
    assert.equal(o.needsShortfallResolution, false);
    assert.equal(o.remainingDebtUsd, 2.72);
    assert.equal(o.needsSurplusDisposition, false);
  });

  it("debt $1,500 + payment $500 => remaining $1,000 without error", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 1000,
      deferredSurplusUsd: 0,
    });
    assert.equal(o.remainingDebtUsd, 1000);
    assert.equal(o.needsShortfallResolution, false);
    assert.equal(o.needsSurplusDisposition, false);
  });

  it("debt $1,500 + payment $1,400 => remaining $100 without error", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 100,
      deferredSurplusUsd: 0,
    });
    assert.equal(o.remainingDebtUsd, 100);
    assert.equal(o.needsShortfallResolution, false);
    assert.equal(o.needsSurplusDisposition, false);
  });

  it("debt $1,500 + payment $1,600 => overpayment $100 requires surplus flow", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 0,
      deferredSurplusUsd: 100,
    });
    assert.equal(o.remainingDebtUsd, 0);
    assert.equal(o.surplusUsd, 100);
    assert.equal(o.needsShortfallResolution, false);
    assert.equal(o.needsSurplusDisposition, true);
  });

  it("deferSurplusDisposition allows save without disposition", () => {
    const d = evaluatePaymentBusinessRules({
      plannedByMethod: [],
      enteredByMethod: [{ bucket: "CASH", label: "מזומן", enteredUsd: 60 }],
      totalDebtUsd: 52.72,
      totalPaymentUsd: 60,
      deferSurplusDisposition: true,
    });
    assert.equal(d.code, "READY");
    assert.equal(d.surplusUsd, 7.28);
  });
});
