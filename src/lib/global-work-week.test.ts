import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveGlobalWorkWeek,
  resolveGlobalWorkWeekScope,
  resolveSourceWeekForPaymentAndBalances,
} from "@/lib/global-work-week";
import { getAhWeekRange, getCurrentBusinessWeek } from "@/lib/work-week";

describe("global-work-week", () => {
  it("AH-137 global → מקור AH-136", () => {
    assert.equal(resolveSourceWeekForPaymentAndBalances("AH-137"), "AH-136");
  });

  it("AH-136 global → מקור AH-135", () => {
    assert.equal(resolveSourceWeekForPaymentAndBalances("AH-136"), "AH-135");
  });

  it("scope — תאריך snapshot = שבת השבוע שנבחר", () => {
    const scope = resolveGlobalWorkWeekScope("AH-137");
    assert.equal(scope.globalWorkWeek, "AH-137");
    assert.equal(scope.sourceWeekCode, "AH-136");
    assert.equal(scope.sourceSnapshotToYmd, getAhWeekRange("AH-137")?.to);
  });

  it("resolveGlobalWorkWeek — נורמליזציה ו-fallback לשבוע העסקי החי", () => {
    const current = getCurrentBusinessWeek().currentBusinessWeekId;
    assert.equal(resolveGlobalWorkWeek(" ah-137 "), "AH-137");
    assert.equal(resolveGlobalWorkWeek(""), current);
    assert.equal(resolveGlobalWorkWeek(null), current);
    assert.equal(resolveGlobalWorkWeek(null, "AH-120"), "AH-120");
    assert.notEqual(resolveGlobalWorkWeek(""), "AH-137");
  });
});
