import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { remainingToPayCardHero } from "@/components/admin/RemainingToPayCard";
import {
  paymentIntakeCustomerBalanceFromCurrentBooks,
  paymentIntakeFinalBalanceCardDisplay,
} from "@/lib/payment-intake-preview";

describe("RemainingToPayCard copy", () => {
  it("101 CURRENT credit shows +$510.00 not $0.00", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 0,
        currentAvailableCreditUsd: 510,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.title, "יתרת לקוח");
    assert.equal(remainingToPayCardHero(d), "+$510.00");
    assert.notEqual(remainingToPayCardHero(d), "$0.00");
    assert.notEqual(remainingToPayCardHero(d), "$0.00 — מאוזן");
  });

  it("open debt shows negative remainder with לתשלום", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 300,
        currentAvailableCreditUsd: 0,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.statusHint, "לתשלום");
    assert.equal(remainingToPayCardHero(d), "-$300.00");
  });

  it("cleared books show $0.00 — מאוזן", () => {
    const d = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: 0,
        currentAvailableCreditUsd: 0,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(d.statusHint, "מאוזן");
    assert.equal(remainingToPayCardHero(d), "$0.00 — מאוזן");
  });
});
