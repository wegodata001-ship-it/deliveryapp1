import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCommissionResetPreviewNumbers } from "@/lib/customer-commission-reset-preview";

describe("computeCommissionResetPreviewNumbers", () => {
  const cases = [
    { debt: 100, commission: 150, after: 50 },
    { debt: 100, commission: 100, after: 0 },
    { debt: 100, commission: 60, after: -40 },
    { debt: 100, commission: 0, after: -100 },
    { debt: 100, commission: -20, after: -120 },
  ] as const;

  for (const { debt, commission, after } of cases) {
    it(`חוב $${debt} | עמלות $${commission} → עמלות אחרי $${after}`, () => {
      const preview = computeCommissionResetPreviewNumbers(debt, commission);
      assert.equal(preview.resetUsd, debt);
      assert.equal(preview.commissionAfterUsd, after);
    });
  }

  it("לא מגביל עמלות שליליות (ללא Math.max)", () => {
    const preview = computeCommissionResetPreviewNumbers(10, 7);
    assert.equal(preview.commissionAfterUsd, -3);
  });
});
