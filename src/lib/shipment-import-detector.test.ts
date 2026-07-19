import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeShipmentWorkbook,
  parseMoney,
} from "@/lib/shipment-import-detector";

describe("shipment import structure detection", () => {
  it("detects a lower Arabic table header and a separate batch header", () => {
    const analysis = analyzeShipmentWorkbook([{
      name: "Müşteriler Cari Özeti",
      grid: [
        [null, "رقم الشحنة", "تاريخ الارسال", "تاريخ الوصول", "مجموع الوزن", "عدد الكراتين"],
        [null, "287-IST-972-17413", "09.07.2026", "30.11.2026", "15.180 KG", "367"],
        [],
        ["الكود", "اسم المشتري", "رقم الهاتف", "العنوان", "تفاصيل الكراتين", "عدد القطع", "الوزن", "المجموع", "ملاحظة"],
        ["21932", "TABASCO", "972546246905", "TEL AVIV", "103, 104", "2", "2,240", "9,025.00 $", "test"],
      ],
    }]);

    assert.equal(analysis.selectedSheet, "Müşteriler Cari Özeti");
    assert.equal(analysis.headerRowIndex, 3);
    assert.equal(analysis.batchMetadata.sourceShipmentNumber, "287-IST-972-17413");
    assert.equal(analysis.batchMetadata.shippingDate, "2026-07-09");
    assert.equal(analysis.batchMetadata.arrivalDate, "2026-11-30");
    assert.equal(analysis.batchMetadata.totalBoxes, 367);
    assert.equal(analysis.batchMetadata.totalWeight, 15180);
    assert.equal(analysis.rows.length, 1);
    assert.equal(analysis.rows[0].customerCode, "21932");
    assert.equal(analysis.rows[0].customerName, "TABASCO");
    assert.equal(analysis.rows[0].customerPhone, "972546246905");
    assert.equal(analysis.rows[0].city, null);
    assert.equal(analysis.rows[0].address, "TEL AVIV");
    assert.equal(analysis.rows[0].boxes, 2);
    assert.equal(analysis.rows[0].weight, 2240);
    assert.equal(analysis.rows[0].orderAmount, 9025);
    assert.equal(analysis.rows[0].orderCurrency, "USD");
    assert.equal(analysis.rows[0].valid, true);
    assert.ok(analysis.diagnostics.some((item) => item.code === "CITY_FALLBACK_TO_ADDRESS"));
  });

  it("detects a first-row Hebrew header without supplier metadata", () => {
    const analysis = analyzeShipmentWorkbook([{
      name: "משלוחים",
      grid: [
        ["שם לקוח", "טלפון", "כתובת", "עיר", "קרטונים", "משקל", "סכום הזמנה", "הערות"],
        ["לקוח א", "0500000000", "הרחוב 1", "חיפה", 3, 42.5, "₪120", "דחוף"],
      ],
    }]);

    assert.equal(analysis.headerRowIndex, 0);
    assert.equal(analysis.rows[0].customerName, "לקוח א");
    assert.equal(analysis.rows[0].city, "חיפה");
    assert.equal(analysis.rows[0].orderAmount, 120);
    assert.equal(analysis.rows[0].orderCurrency, "ILS");
  });

  it("selects the sheet with the strongest shipment-table structure", () => {
    const analysis = analyzeShipmentWorkbook([
      { name: "Notes", grid: [["Report"], ["Generated automatically"]] },
      {
        name: "Data",
        grid: [
          ["Customer Name", "Phone Number", "Address", "Boxes", "Weight", "Order Amount"],
          ["A", "123", "Main Street", 1, 5, "€1.234,56"],
        ],
      },
    ]);

    assert.equal(analysis.selectedSheet, "Data");
    assert.equal(analysis.rows[0].orderAmount, 1234.56);
    assert.equal(analysis.rows[0].orderCurrency, "EUR");
  });
});

describe("shipment amount parsing", () => {
  it("recognizes supported symbols and preserves unknown currency", () => {
    assert.deepEqual(parseMoney("$9,025.00"), {
      amount: 9025,
      currency: "USD",
      raw: "$9,025.00",
    });
    assert.equal(parseMoney("1.234,50 ₺").currency, "TRY");
    assert.equal(parseMoney("75").currency, "UNKNOWN");
    assert.equal(parseMoney("75").amount, 75);
  });
});
