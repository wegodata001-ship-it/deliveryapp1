import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPaymentMethodUI, resolvePaymentMethodUiKey } from "@/lib/payment-method-ui";

describe("payment-method-ui", () => {
  it("maps shipping cash control methods", () => {
    assert.equal(resolvePaymentMethodUiKey("CASH"), "cash");
    assert.equal(resolvePaymentMethodUiKey("BANK_TRANSFER"), "bankTransfer");
    assert.equal(resolvePaymentMethodUiKey("CREDIT_NOTE"), "credit");
    assert.equal(resolvePaymentMethodUiKey("CHECK"), "checks");
    assert.equal(resolvePaymentMethodUiKey("CREDIT"), "card");
    assert.equal(resolvePaymentMethodUiKey("CODE_DEDUCTION"), "codeWithdrawal");
  });

  it("maps regular cash control channels", () => {
    assert.equal(resolvePaymentMethodUiKey("CASH_ILS"), "cash");
    assert.equal(resolvePaymentMethodUiKey("CASH_USD"), "cash");
    assert.equal(resolvePaymentMethodUiKey("BANK_TRANSFER_ILS"), "bankTransfer");
    assert.equal(resolvePaymentMethodUiKey("CREDIT_CARD_USD"), "card");
    assert.equal(resolvePaymentMethodUiKey("CHECK_ILS"), "checks");
  });

  it("returns consistent UI tokens", () => {
    const ui = getPaymentMethodUI("CASH", "מזומן");
    assert.equal(ui.label, "מזומן");
    assert.equal(ui.textColor, "#15803D");
    assert.equal(ui.cssClass, "cc-col--pm-cash");
  });
});
