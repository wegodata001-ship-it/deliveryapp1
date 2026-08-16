import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildShipmentCountryContext,
  getShipmentRoute,
  resolveShipmentNavHref,
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

  it("getShipmentRoute builds country-scoped paths", () => {
    assert.equal(getShipmentRoute("TR"), "/admin/shipments/turkey");
    assert.equal(getShipmentRoute("AE", "import"), "/admin/shipments/uae/import");
    assert.equal(
      getShipmentRoute("CN", "combined", { ids: "a,b" }),
      "/admin/shipments/china/combined?ids=a%2Cb",
    );
  });

  it("resolveShipmentNavHref strips template slug and applies current country", () => {
    assert.equal(
      resolveShipmentNavHref("/admin/shipments/turkey/import", "/admin/shipments/uae/control"),
      "/admin/shipments/uae/import",
    );
    assert.equal(
      resolveShipmentNavHref("/admin/shipments/turkey/locations", "/admin/shipments/china"),
      "/admin/shipments/china/locations",
    );
    assert.equal(
      resolveShipmentNavHref("/admin/shipments/turkey/cash-control", "/admin/shipments/turkey"),
      "/admin/shipments/turkey/cash-control",
    );
    assert.equal(
      resolveShipmentNavHref("/admin/shipments/turkey", "/admin/shipments/uae/manual"),
      "/admin/shipments/uae",
    );
    assert.equal(
      resolveShipmentNavHref("/admin/shipments/turkey/manual", "/admin/shipments"),
      "/admin/shipments",
    );
  });
});
