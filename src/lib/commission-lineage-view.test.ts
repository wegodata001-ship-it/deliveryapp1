import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCommissionEquation,
  formatCommissionSignedCompact,
  commissionTypeLabel,
} from "@/lib/commission-lineage-view";

describe("formatCommissionEquation", () => {
  it("formats 15 + 3 + 5 = 23", () => {
    assert.equal(formatCommissionEquation([15, 3, 5]), "$15 + $3 + $5 = $23");
  });

  it("formats a reduction", () => {
    assert.equal(formatCommissionEquation([15, 3, -4]), "$15 + $3 − $4 = $14");
  });
});

describe("commission type labels", () => {
  it("uses the unified Hebrew labels", () => {
    assert.equal(commissionTypeLabel("ORIGINAL"), "עמלה מקורית");
    assert.equal(commissionTypeLabel("ADD"), "תוספת עמלה");
    assert.equal(commissionTypeLabel("REMOVE"), "הפחתת עמלה");
    assert.equal(formatCommissionSignedCompact(3), "+$3");
    assert.equal(formatCommissionSignedCompact(-4), "-$4");
  });
});
