import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aliasLookupKey,
  locationNamesMatch,
  normalizeLocationName,
} from "@/lib/delivery-location-normalize";

describe("delivery-location-normalize", () => {
  it("normalizes latin case and punctuation", () => {
    assert.equal(normalizeLocationName("  BET-LAHEM  "), "bet lahem");
    assert.equal(normalizeLocationName("Bet, Lahem!"), "bet lahem");
  });

  it("aliasLookupKey ignores spaces hyphens and case", () => {
    const key = aliasLookupKey("BET LAHEM");
    assert.equal(key, aliasLookupKey("BET-LAHEM"));
    assert.equal(key, aliasLookupKey("betlahem"));
    assert.equal(key, aliasLookupKey("Bet Lahem"));
  });

  it("supports Hebrew and Arabic without lowercasing", () => {
    assert.equal(aliasLookupKey("בית לחם"), aliasLookupKey("בית  לחם"));
    assert.equal(aliasLookupKey("بيت لحم"), aliasLookupKey("بيت  لحم"));
  });

  it("locationNamesMatch for spacing variants only", () => {
    assert.ok(locationNamesMatch("BET LAHEM", "BETLAHEM"));
    assert.ok(locationNamesMatch("EL KHALIL", "el khalil"));
    assert.ok(!locationNamesMatch("BET LAHEM", "EL KHALIL"));
    assert.ok(!locationNamesMatch("BET LEHIM", "BET LAHEM"));
  });

  it("handles Bethlehem and Arabic alias key separately", () => {
    assert.equal(aliasLookupKey("Bethlehem"), "bethlehem");
    assert.equal(aliasLookupKey("بيت لحم"), "بيتلحم");
  });
});
