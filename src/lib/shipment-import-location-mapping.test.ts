import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyImportLocationMappingsToRows,
  enrichExcelPreviewRows,
} from "@/lib/shipment-import-preview-utils";
import type { ExcelShipmentPreviewRow } from "@/app/admin/shipments/types";

describe("shipment-import-location-mapping preview rows", () => {
  it("keeps original Excel place on first load", () => {
    const rows = enrichExcelPreviewRows([
      {
        rowIndex: 2,
        customerCode: "101",
        customerName: "לקוח",
        customerPhone: null,
        customerPhone2: null,
        address: null,
        city: "الناصرة",
        cartonDetails: null,
        boxes: 1,
        weight: null,
        orderAmount: null,
        orderCurrency: null,
        orderAmountRaw: null,
        notes: null,
        valid: true,
        error: null,
      },
    ] as ExcelShipmentPreviewRow[]);

    assert.equal(rows[0].originalDeliveryPlace, "الناصرة");
    assert.equal(rows[0].city, "الناصرة");
    assert.equal(rows[0].resolvedDeliveryPlace, undefined);
  });

  it("applies mapping only after user confirmation", () => {
    const base = enrichExcelPreviewRows([
      {
        rowIndex: 2,
        customerCode: null,
        customerName: "x",
        customerPhone: null,
        customerPhone2: null,
        address: null,
        city: "الناصرة",
        cartonDetails: null,
        boxes: 1,
        weight: null,
        orderAmount: null,
        orderCurrency: null,
        orderAmountRaw: null,
        notes: null,
        valid: true,
        error: null,
      },
    ] as ExcelShipmentPreviewRow[]);

    const updated = applyImportLocationMappingsToRows(base, [
      {
        originalPlace: "الناصرة",
        updatedPlace: "נצרת",
        deliveryLocationId: "loc-1",
        zoneId: "zone-1",
        zoneName: "الجليل",
      },
    ]);

    assert.equal(updated[0].originalDeliveryPlace, "الناصرة");
    assert.equal(updated[0].city, "נצרת");
    assert.equal(updated[0].resolvedDeliveryPlace, "נצרת");
    assert.equal(updated[0].zoneId, "zone-1");
    assert.equal(updated[0].locationMatchStatus, "MATCHED");
  });

  it("does not change rows when keeping originals", () => {
    const base = enrichExcelPreviewRows([
      {
        rowIndex: 2,
        customerCode: null,
        customerName: "x",
        customerPhone: null,
        customerPhone2: null,
        address: null,
        city: "שפעמرو",
        cartonDetails: null,
        boxes: 1,
        weight: null,
        orderAmount: null,
        orderCurrency: null,
        orderAmountRaw: null,
        notes: null,
        valid: true,
        error: null,
      },
    ] as ExcelShipmentPreviewRow[]);

    assert.deepEqual(base, base);
    assert.equal(base[0].city, "שפעמرو");
  });
});
