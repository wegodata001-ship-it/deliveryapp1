import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BALANCES_WEEK_PARAM,
  parseBalancesWeekFromSearchParams,
  shouldResyncBalancesLocalWeek,
} from "@/lib/balances-week-filter";

describe("shouldResyncBalancesLocalWeek", () => {
  it("first enter without balancesWeek → seed from global", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "",
        currentBalancesTo: "",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: null,
      }),
      "seed",
    );
  });

  it("first enter with local week already set → keep it", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-137",
        currentBalancesTo: "2026-08-22",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: null,
      }),
      "skip",
    );
  });

  it("first enter with week but missing snapshot date → ensure-to", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-137",
        currentBalancesTo: "",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: null,
      }),
      "ensure-to",
    );
  });

  it("local week navigation does not overwrite back to global", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-137",
        currentBalancesTo: "2026-08-22",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("rapid local hops stay skip (AH-138 → 137 → 136)", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-136",
        currentBalancesTo: "2026-08-15",
        globalWorkWeek: "AH-138",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("global week change syncs the local filter", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-137",
        currentBalancesTo: "2026-08-22",
        globalWorkWeek: "AH-139",
        previousGlobalWorkWeek: "AH-138",
      }),
      "sync-global",
    );
  });
});

describe("parseBalancesWeekFromSearchParams", () => {
  it("balancesWeek wins over competing week=", () => {
    const sp = new URLSearchParams("week=AH-138&balancesWeek=AH-136&country=TURKEY");
    assert.equal(parseBalancesWeekFromSearchParams(sp).weekCode, "AH-136");
  });

  it("falls back to global week when balancesWeek is missing", () => {
    const sp = new URLSearchParams("week=AH-138&country=TURKEY");
    assert.equal(parseBalancesWeekFromSearchParams(sp).weekCode, "AH-138");
  });

  it("official param name is balancesWeek", () => {
    assert.equal(BALANCES_WEEK_PARAM, "balancesWeek");
  });
});
