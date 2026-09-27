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
  resolveBalancesWeekForNav,
  shouldResyncBalancesLocalWeek,
  shouldWriteBalancesLocalWeek,
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

  it("global week change does not overwrite a ready local week", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-137",
        currentBalancesTo: "2026-08-22",
        globalWorkWeek: "AH-139",
        previousGlobalWorkWeek: "AH-138",
      }),
      "skip",
    );
  });

  it("AH-142 global vs AH-143 local never ping-pongs (remount / first enter)", () => {
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-143",
        currentBalancesTo: "2026-10-10",
        globalWorkWeek: "AH-142",
        previousGlobalWorkWeek: null,
      }),
      "skip",
    );
    assert.equal(
      shouldResyncBalancesLocalWeek({
        currentBalancesWeek: "AH-142",
        currentBalancesTo: "2026-10-03",
        globalWorkWeek: "AH-142",
        previousGlobalWorkWeek: null,
      }),
      "skip",
    );
  });
});

describe("balances cutoff captions", () => {
  it("AH-141 screen text uses AH-141 + 26/09/2026, not previous week", () => {
    const text = balancesCumulativeCutoffCaption({
      selectedWeekCode: "AH-141",
      cutoffWeekCode: "AH-141",
      cutoffYmd: "2026-09-26",
    });
    assert.equal(text, "יתרות מצטברות עד סוף 26/09/2026 · AH-141");
    assert.equal(text.includes("היום"), false);
  });

  it("current week caption does not use a historical Saturday", () => {
    assert.equal(
      balancesCumulativeCutoffCaption({
        selectedWeekCode: "AH-142",
        cutoffWeekCode: "AH-142",
        cutoffYmd: "2026-10-03",
        scopeKind: "CURRENT",
      }),
      "מצב יתרות נוכחי · AH-142",
    );
  });

  it("card opened from AH-141 names the parent week and cutoff date", () => {
    assert.equal(
      customerCardBalancesCutoffCaption({
        selectedWeekCode: "AH-141",
        cutoffYmd: "2026-09-26",
      }),
      "כרטסת עד 26/09/2026 — לפי שבוע עבודה AH-141",
    );
  });

  it("AH-141 card open props inherit snapshot cutoff 26/09, not previous Saturday", () => {
    const props = balancesCardOpenProps({
      weekCode: "AH-141",
      snapshotToYmd: "2026-09-26",
      sourceCountry: "TURKEY",
    });
    assert.deepEqual(props, {
      ledgerFromYmd: null,
      ledgerToYmd: "2026-09-26",
      ledgerSelectedWeekCode: "AH-141",
      ledgerCutoffWeekCode: "AH-141",
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

describe("resolveBalancesWeekForNav / shouldWriteBalancesLocalWeek", () => {
  it("sidebar keeps an existing local week instead of week=", () => {
    assert.equal(resolveBalancesWeekForNav("AH-143", "AH-142"), "AH-143");
    assert.equal(resolveBalancesWeekForNav("", "AH-142"), "AH-142");
    assert.equal(resolveBalancesWeekForNav(null, "AH-142"), "AH-142");
  });

  it("client default must not overwrite a ready URL week", () => {
    assert.equal(
      shouldWriteBalancesLocalWeek({
        urlBalancesWeek: "AH-142",
        stateWeekCode: "AH-143",
        userChangedLocalWeek: false,
      }),
      false,
    );
    assert.equal(
      shouldWriteBalancesLocalWeek({
        urlBalancesWeek: "AH-142",
        stateWeekCode: "AH-143",
        userChangedLocalWeek: true,
      }),
      true,
    );
    assert.equal(
      shouldWriteBalancesLocalWeek({
        urlBalancesWeek: "",
        stateWeekCode: "AH-142",
        userChangedLocalWeek: false,
      }),
      false,
    );
    assert.equal(
      shouldWriteBalancesLocalWeek({
        urlBalancesWeek: "",
        stateWeekCode: "AH-143",
        userChangedLocalWeek: true,
      }),
      true,
    );
  });
});
