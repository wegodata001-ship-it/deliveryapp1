import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDERS_WEEK_PARAM,
  ordersWeekRangePatch,
  shouldResyncOrdersLocalWeek,
} from "@/lib/orders-week-filter";
import { getAhWeekRange } from "@/lib/work-week";

describe("shouldResyncOrdersLocalWeek", () => {
  it("first enter without ordersWeek → seed from global", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: null,
      }),
      "seed",
    );
  });

  it("first enter with local week already set → align chrome only", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "AH-139",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: null,
      }),
      "align-chrome",
    );
  });

  it("local week navigation does not overwrite back to global", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "AH-139",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("rapid local hops stay skip (AH-137 → 138 → 139)", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "AH-139",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("writing both params together after a pick is skip", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "AH-139",
        globalWorkWeek: "AH-139",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("independent global week change syncs the local filter", () => {
    assert.equal(
      shouldResyncOrdersLocalWeek({
        currentOrdersWeek: "AH-137",
        globalWorkWeek: "AH-139",
        previousGlobalWorkWeek: "AH-138",
      }),
      "sync-global",
    );
  });
});

describe("ordersWeekRangePatch", () => {
  it("derives from/to from the shared AH week mapping", () => {
    const range = getAhWeekRange("AH-139");
    assert.ok(range);
    const patch = ordersWeekRangePatch("AH-139");
    assert.equal(patch[ORDERS_WEEK_PARAM], "AH-139");
    assert.equal(patch.week, "AH-139");
    assert.equal(patch.ordersFrom, range.from);
    assert.equal(patch.ordersTo, range.to);
    assert.equal(patch.from, range.from);
    assert.equal(patch.to, range.to);
  });

  it("official local SSOT param is ordersWeek", () => {
    assert.equal(ORDERS_WEEK_PARAM, "ordersWeek");
  });
});
