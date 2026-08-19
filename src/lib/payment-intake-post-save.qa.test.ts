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

  it("partial $2.72 remaining — shortfall modal after save", () => {
    const o = computePaymentIntakePostSaveOutcome({
      remainingDebtUsd: 2.72,
      deferredSurplusUsd: 0,
    });
    assert.equal(o.needsShortfallResolution, true);
    assert.equal(o.remainingDebtUsd, 2.72);
    assert.equal(o.needsSurplusDisposition, false);
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
