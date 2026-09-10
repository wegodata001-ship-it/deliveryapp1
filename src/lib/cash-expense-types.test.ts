import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cashExpenseTypeLabelKey,
  findCashExpenseTypeByLabel,
  normalizeCashExpenseTypeLabel,
  validateNewCashExpenseTypeLabel,
} from "@/lib/cash-expense-types";

const EXISTING = [
  { code: "FUEL", label: "דלק" },
  { code: "OTHER", label: "אחר" },
  { code: "CE_WASH", label: "שטיפת רכב" },
];

describe("cash expense type normalization", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeCashExpenseTypeLabel("שטיפת רכב"), "שטיפת רכב");
    assert.equal(normalizeCashExpenseTypeLabel(" שטיפת רכב "), "שטיפת רכב");
    assert.equal(normalizeCashExpenseTypeLabel("שטיפת  רכב"), "שטיפת רכב");
    assert.equal(normalizeCashExpenseTypeLabel("שטיפת\tרכב"), "שטיפת רכב");
  });

  it("treats spaced and cased variants as the same key", () => {
    const key = cashExpenseTypeLabelKey("שטיפת רכב");
    assert.equal(cashExpenseTypeLabelKey(" שטיפת רכב "), key);
    assert.equal(cashExpenseTypeLabelKey("שטיפת  רכב"), key);
    assert.equal(cashExpenseTypeLabelKey("Fuel"), cashExpenseTypeLabelKey("FUEL"));
  });

  it("rejects empty or whitespace-only names", () => {
    assert.equal(validateNewCashExpenseTypeLabel(""), "יש להזין שם לסוג ההוצאה");
    assert.equal(validateNewCashExpenseTypeLabel("   "), "יש להזין שם לסוג ההוצאה");
    assert.equal(validateNewCashExpenseTypeLabel("שטיפת רכב"), null);
  });

  it("reuses an existing type instead of creating a duplicate", () => {
    assert.equal(findCashExpenseTypeByLabel(EXISTING, " שטיפת רכב ")?.code, "CE_WASH");
    assert.equal(findCashExpenseTypeByLabel(EXISTING, "שטיפת  רכב")?.code, "CE_WASH");
    assert.equal(findCashExpenseTypeByLabel(EXISTING, "דלק")?.code, "FUEL");
    assert.equal(findCashExpenseTypeByLabel(EXISTING, "ביטוח רכב"), null);
  });

  it("keeps אחר as its own existing type", () => {
    assert.equal(findCashExpenseTypeByLabel(EXISTING, "אחר")?.code, "OTHER");
  });
});
