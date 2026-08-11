import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupIntakePaymentsByBankTarget,
  pickDefaultBankTarget,
  resolveBankIdentityFromPayment,
} from "@/lib/flow-control/fx-purchase/remainder-bank-resolution.shared";

describe("QA: יעד בנק ליתרת FX", () => {
  it("מזהה בנק מ-paymentPlace", () => {
    const id = resolveBankIdentityFromPayment(
      {
        id: "p1",
        paymentPlace: "בנק הפועלים",
        ilsNote: null,
        notes: null,
        paymentMethod: "BANK_TRANSFER",
        ilsPaymentMethod: "BANK_TRANSFER",
        usdPaymentMethod: null,
        amountIls: { toString: () => "12000" },
        amountUsd: null,
        methodAllocations: [],
      },
      [{ id: "loc-1", name: "בנק הפועלים", code: null }],
    );
    assert.equal(id.bankAccountId, "loc-1");
    assert.equal(id.bankLabel, "בנק הפועלים");
  });

  it("מקבץ כמה בנקים — לא בוחר ברירת מחדל", () => {
    const targets = groupIntakePaymentsByBankTarget(
      [
        {
          id: "p1",
          paymentPlace: "בנק הפועלים",
          ilsNote: null,
          notes: null,
          paymentMethod: "BANK_TRANSFER",
          ilsPaymentMethod: "BANK_TRANSFER",
          usdPaymentMethod: null,
          amountIls: { toString: () => "12000" },
          amountUsd: null,
          methodAllocations: [
            { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: { toString: () => "12000" } },
          ],
        },
        {
          id: "p2",
          paymentPlace: "בנק לאומי",
          ilsNote: null,
          notes: null,
          paymentMethod: "BANK_TRANSFER",
          ilsPaymentMethod: "BANK_TRANSFER",
          usdPaymentMethod: null,
          amountIls: { toString: () => "8000" },
          amountUsd: null,
          methodAllocations: [
            { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: { toString: () => "8000" } },
          ],
        },
      ],
      [],
      "PS",
    );
    assert.equal(targets.length, 2);
    assert.equal(pickDefaultBankTarget(targets), null);
  });

  it("בנק יחיד — נבחר אוטומטית", () => {
    const targets = groupIntakePaymentsByBankTarget(
      [
        {
          id: "p1",
          paymentPlace: "בנק לאומי",
          ilsNote: null,
          notes: null,
          paymentMethod: "BANK_TRANSFER",
          ilsPaymentMethod: "BANK_TRANSFER",
          usdPaymentMethod: null,
          amountIls: { toString: () => "5000" },
          amountUsd: null,
          methodAllocations: [
            { method: "BANK_TRANSFER", currency: "ILS", sourceAmount: { toString: () => "5000" } },
          ],
        },
      ],
      [],
      "IL",
    );
    const def = pickDefaultBankTarget(targets);
    assert.ok(def);
    assert.equal(def?.bankLabel, "בנק לאומי");
  });
});
