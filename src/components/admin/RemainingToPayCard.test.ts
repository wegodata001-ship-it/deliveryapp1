import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { remainingToPayCardHero } from "@/components/admin/RemainingToPayCard";
import {
  paymentIntakeCustomerBalanceFromCurrentBooks,
  paymentIntakeFinalBalanceCardDisplay,
} from "@/lib/payment-intake-preview";

describe("RemainingToPayCard copy", () => {
  it("101 CURRENT credit shows +$409.00 not $0.00", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 0,
        currentAvailableCreditUsd: 409,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.title, "יתרת לקוח");
    assert.equal(d.statusHint, "יתרת זכות ללקוח");
    assert.equal(remainingToPayCardHero(d), "+$409.00");
    assert.notEqual(remainingToPayCardHero(d), "$0.00");
  });

  it("open debt shows −$610.00 with חוב פתוח", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 610,
        currentAvailableCreditUsd: 0,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.statusHint, "חוב פתוח");
    assert.equal(remainingToPayCardHero(d), "-$610.00");
  });

  it("cleared books show $0.00 and חשבון מאוזן", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 0,
        currentAvailableCreditUsd: 0,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.statusHint, "חשבון מאוזן");
    assert.equal(remainingToPayCardHero(d), "$0.00");
  });
});
