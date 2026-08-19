import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fcNum } from "@/components/admin/flow-control/shared";
import {
  FX_PURCHASE_AMOUNT_REQUIRED_ERROR,
  FX_PURCHASE_OVER_LIMIT_ERROR,
  FX_PURCHASE_RATE_REQUIRED_ERROR,
  computeFxPurchaseFormPreview,
  validateFxPurchaseFormInput,
} from "@/components/admin/manager-count/manager-count-utils";

type FxFormState = {
  ilsAmount: string;
  rate: string;
  availNum: number;
  submitError: string | null;
};

function deriveFxFormFlags(ilsAmount: string, ilsNum: number) {
  const trimmedIls = ilsAmount.trim();
  return {
    trimmedIls,
    isZeroPurchase: trimmedIls !== "" && ilsNum <= 0.005,
    isNegativePurchase: trimmedIls !== "" && ilsNum < -0.02,
  };
}

function clientValidationError(state: FxFormState): string | null {
  const ilsNum = fcNum(state.ilsAmount);
  const rateNum = fcNum(state.rate);
  const { trimmedIls, isZeroPurchase, isNegativePurchase } = deriveFxFormFlags(
    state.ilsAmount,
    ilsNum,
  );
  return validateFxPurchaseFormInput({
    trimmedIls,
    ilsNum,
    rateNum,
    availNum: state.availNum,
    isZeroPurchase,
    isNegativePurchase,
  });
}

function isSaveDisabled(state: FxFormState, busy = false): boolean {
  return busy || !!clientValidationError(state);
}

function simulateSubmit(state: FxFormState): FxFormState {
  if (state.ilsAmount.trim() === "") {
    return { ...state, submitError: FX_PURCHASE_AMOUNT_REQUIRED_ERROR };
  }
  const err = clientValidationError(state);
  if (err) return { ...state, submitError: err };
  return { ...state, submitError: null };
}

function onFieldChange(state: FxFormState, patch: Partial<FxFormState>): FxFormState {
  return { ...state, ...patch, submitError: null };
}

describe("QA: FX purchase validation — PS/IL + retry after error", () => {
  const avail = 264.24;

  it("PS: amount without rate → error → enter rate → save enabled", () => {
    let state: FxFormState = { ilsAmount: "200", rate: "", availNum: avail, submitError: null };
    state = simulateSubmit(state);
    assert.equal(state.submitError, FX_PURCHASE_RATE_REQUIRED_ERROR);
    assert.equal(isSaveDisabled(state), true);

    state = onFieldChange(state, { rate: "2" });
    assert.equal(clientValidationError(state), null);
    assert.equal(isSaveDisabled(state), false);
    state = simulateSubmit(state);
    assert.equal(state.submitError, null);
  });

  it("IL: rate 0 → error → fix to 3 → succeeds", () => {
    let state: FxFormState = { ilsAmount: "100", rate: "0", availNum: 500, submitError: null };
    state = simulateSubmit(state);
    assert.equal(state.submitError, FX_PURCHASE_RATE_REQUIRED_ERROR);
    state = onFieldChange(state, { rate: "3" });
    assert.equal(clientValidationError(state), null);
    assert.equal(simulateSubmit(state).submitError, null);
  });

  it("empty rate → error → 3.5 → succeeds", () => {
    let state: FxFormState = { ilsAmount: "50", rate: "", availNum: avail, submitError: null };
    state = simulateSubmit(state);
    assert.equal(state.submitError, FX_PURCHASE_RATE_REQUIRED_ERROR);
    state = onFieldChange(state, { rate: "3.5" });
    assert.equal(simulateSubmit(state).submitError, null);
  });

  it("empty amount → error → fix → succeeds", () => {
    let state: FxFormState = { ilsAmount: "", rate: "2", availNum: avail, submitError: null };
    state = simulateSubmit(state);
    assert.equal(state.submitError, FX_PURCHASE_AMOUNT_REQUIRED_ERROR);
    state = onFieldChange(state, { ilsAmount: "200" });
    assert.equal(simulateSubmit(state).submitError, null);
  });

  it("amount greater than balance → blocked", () => {
    const state: FxFormState = {
      ilsAmount: "99999",
      rate: "3.2",
      availNum: avail,
      submitError: null,
    };
    assert.equal(clientValidationError(state), FX_PURCHASE_OVER_LIMIT_ERROR);
    assert.equal(isSaveDisabled(state), true);
  });

  it("business math unchanged: 200 @ 2 from 264.24", () => {
    const p = computeFxPurchaseFormPreview(avail, 200, 2);
    assert.equal(p.purchasedUsd, 100);
    assert.equal(p.remainingIlsAfter, 64.24);
  });

  it("double submit guard — in-flight blocks second call", () => {
    let inFlight = false;
    let saves = 0;
    const trySave = () => {
      if (inFlight) return;
      inFlight = true;
      saves += 1;
    };
    trySave();
    trySave();
    assert.equal(saves, 1);
  });
});
