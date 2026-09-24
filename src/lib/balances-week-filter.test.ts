import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BALANCES_WEEK_PARAM,
  balancesCardOpenProps,
  balancesCumulativeCutoffCaption,
  customerCardBalancesCutoffCaption,
  customerCardLedgerViewMode,
  isBalancesWeekReady,
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

describe("balances cutoff captions", () => {
  it("AH-141 screen text uses AH-140 + 19/09/2026, not today", () => {
    const text = balancesCumulativeCutoffCaption({
      selectedWeekCode: "AH-141",
      cutoffWeekCode: "AH-140",
      cutoffYmd: "2026-09-19",
    });
    assert.equal(text, "יתרות מצטברות עד סוף AH-140 · 19/09/2026");
    assert.equal(text.includes("היום"), false);
  });

  it("card opened from AH-141 names the parent week and cutoff date", () => {
    assert.equal(
      customerCardBalancesCutoffCaption({
        selectedWeekCode: "AH-141",
        cutoffYmd: "2026-09-19",
      }),
      "כרטסת עד 19/09/2026 — לפי שבוע עבודה AH-141",
    );
  });

  it("AH-141 card open props inherit snapshot cutoff 19/09, not today", () => {
    const props = balancesCardOpenProps({
      weekCode: "AH-141",
      snapshotToYmd: "2026-09-19",
      sourceCountry: "TURKEY",
    });
    assert.deepEqual(props, {
      ledgerFromYmd: null,
      ledgerToYmd: "2026-09-19",
      ledgerSelectedWeekCode: "AH-141",
      ledgerCutoffWeekCode: "AH-140",
      ledgerSourceCountry: "TURKEY",
    });
    assert.equal(
      customerCardLedgerViewMode({
        parentToYmd: props.ledgerToYmd,
        parentFromYmd: props.ledgerFromYmd,
        currentFromYmd: "",
        currentToYmd: props.ledgerToYmd ?? "",
      }),
      "parent-cutoff",
    );
    assert.equal(
      customerCardLedgerViewMode({
        parentToYmd: props.ledgerToYmd,
        parentFromYmd: props.ledgerFromYmd,
        currentFromYmd: "",
        currentToYmd: "",
      }),
      "lifetime",
    );
  });
});

describe("parseBalancesWeekFromSearchParams", () => {
  it("balancesWeek wins over competing week=", () => {
    const sp = new URLSearchParams("week=AH-138&balancesWeek=AH-136&country=TURKEY");
    assert.equal(parseBalancesWeekFromSearchParams(sp).weekCode, "AH-136");
  });

  it("ignores global week= — balancesWeek is the only local SSOT", () => {
    const sp = new URLSearchParams("week=AH-138&country=TURKEY");
    assert.equal(parseBalancesWeekFromSearchParams(sp).weekCode, "");
  });

  it("official param name is balancesWeek", () => {
    assert.equal(BALANCES_WEEK_PARAM, "balancesWeek");
  });

  it("is ready only after balancesWeek exists", () => {
    assert.equal(isBalancesWeekReady(new URLSearchParams("week=AH-138")), false);
    assert.equal(isBalancesWeekReady(new URLSearchParams("balancesWeek=AH-139")), true);
  });
});
