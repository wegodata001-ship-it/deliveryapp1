import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  distributionAreaLookupKey,
  distributionAreaNameMatchesQuery,
  distributionAreaValidationError,
  isValidDistributionAreaName,
  sanitizeDistributionAreaName,
} from "@/lib/distribution-area-name";

describe("distribution-area-name free-form zones", () => {
  const samples = [
    "צפון",
    "דרום",
    "מרכז",
    "גליל",
    "משולש",
    "ירושלים",
    "אזור 1",
    "אזור A",
    "الناصرة",
    "الجليل",
    "المثلث",
    "القدس",
    "كفر كنا",
    "شفاعمرو",
    "سخنين",
    "منطقة الشمال",
    "منطقة 1",
    "Zone 7",
    "אזור בדיקה",
  ];

  it("accepts all free-form zone names including Arabic", () => {
    for (const name of samples) {
      assert.equal(distributionAreaValidationError(name), null, name);
      assert.equal(sanitizeDistributionAreaName(name), name, name);
      assert.ok(isValidDistributionAreaName(name), name);
    }
  });

  it("preserves user display name after whitespace sanitize only", () => {
    assert.equal(sanitizeDistributionAreaName("  16 צפון  "), "16 צפון");
    assert.equal(sanitizeDistributionAreaName("  الجليل  "), "الجليل");
  });

  it("uses lookup key for search without changing display", () => {
    assert.ok(distributionAreaNameMatchesQuery("الجليل", "الج"));
    assert.ok(distributionAreaNameMatchesQuery("منطقة الشمال", "شمال"));
    assert.ok(distributionAreaLookupKey("  Zone 7 ").includes("zone 7"));
  });

  it("rejects blocked headers and empty", () => {
    assert.equal(sanitizeDistributionAreaName("אזור חלוקה"), null);
    assert.equal(sanitizeDistributionAreaName("  "), null);
    assert.ok(distributionAreaValidationError("אזור חלוקה"));
  });
});
