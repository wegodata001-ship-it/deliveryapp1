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
        updatedDeliveryLocation: "תל אביב",
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

  it("city שונה מהמקור ללא updated — לא מסמן city כעדכון", () => {
    assert.equal(
      getEffectiveDeliveryPlace({
        originalDeliveryLocation: "NASRAH Nasrah",
        city: "נצרת",
        updatedDeliveryLocation: "NASRAH Nasrah",
      }),
      "NASRAH Nasrah",
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
  it("מקום מעודכן — מציג updatedDeliveryLocation בלבד", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "NASRAH Nasrah Street 12",
      originalDeliveryLocation: "NASRAH Nasrah",
      city: "נצרת",
      updatedDeliveryLocation: "נצרת",
    });
    assert.equal(addr.display, "נצרת");
    assert.equal(addr.isPlaceUpdated, true);
    assert.equal(addr.originalDisplay, "NASRAH Nasrah");
  });

  it("כתובת מעודכנת — לא מציג טקסט ייבוא מקורי", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "TEL AVIV Tel Aviv, תל אביב",
      originalDeliveryLocation: "TEL AVIV Tel Aviv",
      updatedDeliveryLocation: "כפר מנדא",
      city: "כפר מנדא",
    });
    assert.equal(addr.display, "כפר מנדא");
    assert.equal(addr.isPlaceUpdated, true);
    assert.equal(addr.originalDisplay, "TEL AVIV Tel Aviv");
  });

  it("city מלוכלך + updated SSOT — מציג updated בלבד", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "TEL AVIV Tel Aviv, תל אביב",
      originalDeliveryLocation: "TEL AVIV Tel Aviv",
      updatedDeliveryLocation: "תל אביב",
      city: "TEL AVIV Tel Aviv, תל אביב",
      locationMatchStatus: "MATCHED",
    });
    assert.equal(addr.display, "תל אביב");
    assert.equal(addr.isPlaceUpdated, true);
    assert.equal(addr.originalDisplay, "TEL AVIV Tel Aviv");
  });

  it("Ber Sabe — מציג display name מעודכן", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "Ber Sabe באר שבע",
      originalDeliveryLocation: "Ber Sabe",
      updatedDeliveryLocation: "באר שבע",
      city: "Ber Sabe באר שבע",
      locationMatchStatus: "MATCHED",
    });
    assert.equal(addr.display, "באר שבע");
    assert.equal(addr.isPlaceUpdated, true);
    assert.equal(addr.originalDisplay, "Ber Sabe");
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

  it("city מלוכלך ללא updated — לא מסמן badge", () => {
    const addr = getEffectiveDeliveryAddress({
      address: "TEL AVIV Tel Aviv, תל אביב",
      originalDeliveryLocation: "TEL AVIV Tel Aviv",
      city: "TEL AVIV Tel Aviv, תל אביב",
    });
    assert.equal(addr.isPlaceUpdated, false);
    assert.equal(addr.display, "TEL AVIV Tel Aviv");
  });
});

describe("shipmentOriginalDeliveryPlace", () => {
  it("שומר על המקור — לא נופל ל-city", () => {
    assert.equal(
      shipmentOriginalDeliveryPlace({
        originalDeliveryPlace: "TEL AVIV Tel Aviv",
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

describe("audit display matrix", () => {
  const cases = [
    {
      label: "TEL AVIV → תל אביב",
      input: {
        originalDeliveryLocation: "TEL AVIV Tel Aviv",
        updatedDeliveryLocation: "תל אביב",
        city: "TEL AVIV Tel Aviv, תל אביב",
        address: "TEL AVIV Tel Aviv, תל אביב",
        locationMatchStatus: "MATCHED" as const,
      },
      expectedDisplay: "תל אביב",
    },
    {
      label: "Ber Sabe → באר שבע",
      input: {
        originalDeliveryLocation: "Ber Sabe",
        updatedDeliveryLocation: "באר שבע",
        city: "Ber Sabe באר שבע",
        address: null,
        locationMatchStatus: "MATCHED" as const,
      },
      expectedDisplay: "באר שבע",
    },
    {
      label: "כפר מנדא manual",
      input: {
        originalDeliveryLocation: "TEL AVIV Tel Aviv",
        updatedDeliveryLocation: "כפר מנדא",
        city: "כפר מנדא",
        address: "TEL AVIV Tel Aviv, תל אביב",
        locationMatchStatus: "MANUALLY_FIXED" as const,
      },
      expectedDisplay: "כפר מנדא",
    },
    {
      label: "מרכז 11",
      input: {
        originalDeliveryLocation: "TEL AVIV Tel Aviv",
        updatedDeliveryLocation: "מרכז 11",
        city: "מרכז 11",
        address: "TEL AVIV Tel Aviv, תל אביב",
        locationMatchStatus: "MANUALLY_FIXED" as const,
      },
      expectedDisplay: "מרכז 11",
    },
    {
      label: "ללא עדכון",
      input: {
        originalDeliveryLocation: "חיפה",
        updatedDeliveryLocation: "חיפה",
        city: "חיפה",
        address: null,
        locationMatchStatus: "UNMATCHED" as const,
      },
      expectedDisplay: "חיפה",
    },
  ] as const;

  for (const c of cases) {
    it(`audit: ${c.label}`, () => {
      const addr = getEffectiveDeliveryAddress(c.input);
      assert.equal(addr.display, c.expectedDisplay);
      if (c.input.updatedDeliveryLocation !== c.input.originalDeliveryLocation) {
        assert.equal(addr.isPlaceUpdated, true);
        assert.equal(addr.display, addr.updatedDisplay);
      }
    });
  }
});
