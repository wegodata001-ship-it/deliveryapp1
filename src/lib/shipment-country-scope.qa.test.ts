import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShipmentCountryContext,
  workCountryFromShipmentSlug,
} from "@/lib/shipment-country-scope.shared";

describe("shipment country scope", () => {
  it("maps slugs to work countries", () => {
    assert.equal(workCountryFromShipmentSlug("turkey"), "TR");
    assert.equal(workCountryFromShipmentSlug("china"), "CN");
    assert.equal(workCountryFromShipmentSlug("uae"), "AE");
    assert.equal(workCountryFromShipmentSlug("invalid"), null);
  });

  it("builds isolated base paths per country", () => {
    assert.equal(buildShipmentCountryContext("TR").basePath, "/admin/shipments/turkey");
    assert.equal(buildShipmentCountryContext("CN").basePath, "/admin/shipments/china");
    assert.equal(buildShipmentCountryContext("AE").basePath, "/admin/shipments/uae");
  });
});
