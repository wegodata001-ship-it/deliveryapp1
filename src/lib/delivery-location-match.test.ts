import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAliasLookupMap,
  lookupAliasRow,
  resolveUpdatedDeliveryLocationDisplay,
  shipmentOriginalDeliveryLocationName,
} from "@/lib/delivery-location-match";

const SAMPLE_ROWS = [
  {
    id: "a1",
    originalName: "BET LAHEM",
    normalizedOriginalName: "betlahem",
    deliveryLocationId: "loc1",
    displayName: "בית לחם",
    distributionAreaId: "z1",
    zoneName: "דרום 1",
    zoneIsActive: true,
    locationActive: true,
  },
  {
    id: "a2",
    originalName: "بيت لحم",
    normalizedOriginalName: "بيتلحم",
    deliveryLocationId: "loc1",
    displayName: "בית לחם",
    distributionAreaId: "z1",
    zoneName: "דרום 1",
    zoneIsActive: true,
    locationActive: true,
  },
  {
    id: "a3",
    originalName: "EL KHALIL",
    normalizedOriginalName: "elkhalil",
    deliveryLocationId: "loc2",
    displayName: "חברון",
    distributionAreaId: "z2",
    zoneName: "דרום 2",
    zoneIsActive: true,
    locationActive: true,
  },
];

describe("delivery-location-match", () => {
  const maps = buildAliasLookupMap(SAMPLE_ROWS);

  it("matches supplier spacing variants via compact key", () => {
    assert.equal(lookupAliasRow("BETLAHEM", maps)?.displayName, "בית לחם");
    assert.equal(lookupAliasRow("bet-lahem", maps)?.displayName, "בית לחם");
    assert.equal(lookupAliasRow("Bet Lahem", maps)?.displayName, "בית לחם");
  });

  it("does not match spelling typos without alias row", () => {
    assert.equal(lookupAliasRow("BET LEHIM", maps)?.displayName, undefined);
    assert.equal(lookupAliasRow("Bethlehem", maps)?.displayName, undefined);
  });

  it("matches Arabic alias", () => {
    assert.equal(lookupAliasRow("بيت لحم", maps)?.displayName, "בית לחם");
  });

  it("matches Hebrew canonical display name", () => {
    assert.equal(lookupAliasRow("בית לחם", maps)?.displayName, "בית לחם");
  });

  it("matches EL KHALIL variants to Hebron", () => {
    assert.equal(lookupAliasRow("KHALIL", maps)?.displayName, undefined);
    assert.equal(lookupAliasRow("EL KHALIL", maps)?.displayName, "חברון");
    assert.equal(lookupAliasRow("el khalil", maps)?.displayName, "חברון");
  });

  it("returns mapped displayName when alias exists", () => {
    const out = resolveUpdatedDeliveryLocationDisplay(
      { originalDeliveryLocation: "BET LAHEM", city: "BET LAHEM", address: "רחוב 1" },
      maps,
    );
    assert.equal(out, "בית לחם");
  });

  it("returns null when no alias and no FK update", () => {
    const out = resolveUpdatedDeliveryLocationDisplay(
      { originalDeliveryLocation: "ירושלים", city: "ירושלים", address: null },
      maps,
    );
    assert.equal(out, null);
  });

  it("original name prefers originalDeliveryLocation field", () => {
    assert.equal(
      shipmentOriginalDeliveryLocationName({
        originalDeliveryLocation: "מקור",
        city: "עיר",
        address: "כתובת",
      }),
      "מקור",
    );
  });
});
