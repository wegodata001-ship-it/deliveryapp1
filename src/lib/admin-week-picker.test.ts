import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAdminWeekPickerOptions, weekMatchesQuery } from "@/lib/admin-week-picker";

describe("weekMatchesQuery", () => {
  it("matches digits inside AH code", () => {
    assert.equal(weekMatchesQuery("AH-139", "139"), true);
    assert.equal(weekMatchesQuery("AH-139", "13"), true);
    assert.equal(weekMatchesQuery("AH-139", "140"), false);
  });

  it("matches full AH code in any case", () => {
    assert.equal(weekMatchesQuery("AH-139", "AH-139"), true);
    assert.equal(weekMatchesQuery("AH-139", "ah-139"), true);
    assert.equal(weekMatchesQuery("AH-139", "ah139"), true);
  });

  it("empty query keeps every week", () => {
    assert.equal(weekMatchesQuery("AH-1", ""), true);
    assert.equal(weekMatchesQuery("AH-1", "   "), true);
  });
});

describe("listAdminWeekPickerOptions", () => {
  it("includes the selected week and filters locally", () => {
    const all = listAdminWeekPickerOptions("AH-139");
    assert.ok(all.includes("AH-139"));
    const filtered = all.filter((w) => weekMatchesQuery(w, "139"));
    assert.ok(filtered.includes("AH-139"));
    assert.ok(filtered.every((w) => w.includes("139") || w.replace(/^AH-/, "").includes("139")));
  });
});
