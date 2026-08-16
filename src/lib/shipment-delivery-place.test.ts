import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getEffectiveDeliveryAddress,
  getEffectiveDeliveryPlace,
  getEffectiveDeliveryPlaceFromRecord,
  shipmentOriginalDeliveryPlace,
} from "@/lib/shipment-delivery-place";

describe("getEffectiveDeliveryPlace", () => {
  it("מציג מקורי כשאין עדכון", () => {
    assert.equal(
      getEffectiveDeliveryPlace({
        originalDeliveryPlace: "TEL AVIV Tel Aviv",
        city: "TEL AVIV Tel Aviv",
      }),
      "TEL AVIV Tel Aviv",
    );
  });

  it("מציג מעודכן במקום מקורי", () => {
    assert.equal(
      getEffectiveDeliveryPlace({
        originalDeliveryPlace: "TEL AVIV Tel Aviv",
        resolvedDeliveryPlace: "תל אביב",
        city: "תל אביב",
      }),
      "תל אביב",
    );
  });

  it("לא מחבר שני ערכים", () => {
    const value = getEffectiveDeliveryPlace({
      originalDeliveryPlace: "yafa nasrah",
      updatedDeliveryLocation: "יפיע",
      city: "יפיע",
    });
    assert.equal(value, "יפיע");
    assert.ok(!value?.includes("yafa"));
  });

  it("city שונה מהמקור ללא alias — מציג city", () => {
    assert.equal(
      getEffectiveDeliveryPlace({
        originalDeliveryLocation: "NASRAH Nasrah",
        city: "נצרת",
        updatedDeliveryLocation: "NASRAH Nasrah",
      }),
      "נצרת",
    );
  });

  it("MANUALLY_FIXED עם city כגיבוי", () => {
    assert.equal(
      getEffectiveDeliveryPlace({
        originalDeliveryLocation: "TEL AVIV",
        city: "נצרת",
        locationMatchStatus: "MANUALLY_FIXED",
      }),
      "נצרת",
    );
  });
});

describe("getEffectiveDeliveryAddress", () => {
  it("מחבר רחוב + מקום מעודכן", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "NASRAH Nasrah Street 12",
      originalDeliveryLocation: "NASRAH Nasrah",
      city: "נצרת",
      updatedDeliveryLocation: "נצרת",
    });
    assert.equal(addr.display, "NASRAH Nasrah Street 12, נצרת");
    assert.equal(addr.isPlaceUpdated, true);
    assert.equal(addr.originalDisplay, "NASRAH Nasrah Street 12, NASRAH Nasrah");
  });

  it("ללא עדכון — מציג מקור בלבד", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "רחוב 1",
      originalDeliveryLocation: "חיפה",
      city: "חיפה",
    });
    assert.equal(addr.display, "רחוב 1, חיפה");
    assert.equal(addr.isPlaceUpdated, false);
  });
});

describe("shipmentOriginalDeliveryPlace", () => {
  it("שומר על המקור לעריכה", () => {
    assert.equal(
      shipmentOriginalDeliveryPlace({
        originalDeliveryPlace: "TEL AVIV Tel Aviv",
        city: "תל אביב",
      }),
      "TEL AVIV Tel Aviv",
    );
  });
});

describe("getEffectiveDeliveryPlaceFromRecord", () => {
  it("עוטף ShipmentRecordDto", () => {
    assert.equal(
      getEffectiveDeliveryPlaceFromRecord({
        originalDeliveryLocation: "الناصرة",
        updatedDeliveryLocation: "נצרת",
        city: "נצרת",
        address: null,
        locationMatchStatus: "MATCHED",
      }),
      "נצרת",
    );
  });
});
