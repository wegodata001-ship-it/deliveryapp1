import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeliveryFeeSystemGroups,
  normalizeCustomerCodeKey,
  parseDeliveryFeeImportGrid,
  parseDeliveryFeeMoney,
  previewDeliveryFeeImport,
} from "@/lib/shipment-delivery-fee-import";

describe("shipment delivery fee import", () => {
  it("parseDeliveryFeeMoney — ₪ ופסיקים", () => {
    assert.equal(parseDeliveryFeeMoney("₪2,550"), 2550);
    assert.equal(parseDeliveryFeeMoney("180"), 180);
  });

  it("parseDeliveryFeeImportGrid — כותרות ערבית + שורת כותרת עליונה", () => {
    const grid = [
      ["شحنة 1297 كونتينر رقم 4"],
      [],
      ["عدد", "كود", "اسم الزبون", "المنطقة", "اجور الشحن", "تحصيل", "متبقي", "الهاتف"],
      [1, 40062, "לקוח א", "צפון", "₪180", 0, 180, "050-123"],
      [7, 65561, "לקוח ב", "דרום", 900, 0, 900, "050-456"],
    ];
    const parsed = parseDeliveryFeeImportGrid(grid);
    assert.equal(parsed.mappingError, null);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]!.customerCode, "40062");
    assert.equal(parsed.rows[0]!.boxes, 1);
    assert.equal(parsed.rows[0]!.deliveryFeeIls, 180);
    assert.equal(parsed.rows[0]!.customerName, "לקוח א");
    assert.equal(parsed.rows[0]!.area, "צפון");
  });

  it("parseDeliveryFeeImportGrid — סדר עמודות משתנה", () => {
    const grid = [
      ["اسم الزبون", "اجور الشحن", "كود", "عدد"],
      ["X", 250, 67274, 19],
    ];
    const parsed = parseDeliveryFeeImportGrid(grid);
    assert.equal(parsed.mappingError, null);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]!.customerCode, "67274");
    assert.equal(parsed.rows[0]!.boxes, 19);
    assert.equal(parsed.rows[0]!.deliveryFeeIls, 250);
  });

  it("normalizeCustomerCodeKey — ATS וספרות", () => {
    assert.equal(normalizeCustomerCodeKey("ATS40062"), normalizeCustomerCodeKey("40062"));
  });

  it("preview — התאמה לפי קוד + סך קרטונים", () => {
    const groups = buildDeliveryFeeSystemGroups([
      { id: "r1", rowIndex: 1, customerCode: "40062", customerName: "A", boxes: 1, cartonDetails: "34", deliveryFeeAmount: null, deliveryFeeIls: null },
      { id: "r2", rowIndex: 2, customerCode: "40062", customerName: "A", boxes: 1, cartonDetails: "35", deliveryFeeAmount: null, deliveryFeeIls: null },
      { id: "r3", rowIndex: 3, customerCode: "40062", customerName: "A", boxes: 1, cartonDetails: "36", deliveryFeeAmount: null, deliveryFeeIls: null },
    ]);
    const key = normalizeCustomerCodeKey("40062");
    assert.equal(groups.get(key)?.totalBoxes, 3);

    const preview = previewDeliveryFeeImport({
      shipmentLabel: "CNT-1",
      batch: { batchNumber: "SHP-1", containerNumber: "CNT-1", sourceShipmentNumber: null },
      fileRows: [
        {
          excelRow: 2,
          customerCode: "40062",
          customerName: null,
          area: null,
          containerNumber: null,
          boxes: 3,
          deliveryFeeIls: 180,
        },
      ],
      systemGroups: groups,
    });

    assert.equal(preview.willUpdateCount, 1);
    assert.equal(preview.updates.length, 1);
    assert.equal(preview.updates[0]!.feeAfterIls, 180);
    assert.equal(preview.updates[0]!.primaryRecordId, "r1");
    assert.deepEqual(preview.updates[0]!.siblingRecordIds, ["r2", "r3"]);
    assert.equal(preview.rows[0]!.breakdown.systemLines.length, 3);
    assert.equal(preview.rows[0]!.breakdown.systemLines[0]!.label, "קרטון 34");
  });

  it("preview — ללא התאמה בקרטונים", () => {
    const groups = buildDeliveryFeeSystemGroups([
      { id: "r1", rowIndex: 1, customerCode: "40062", customerName: null, boxes: 2, deliveryFeeAmount: null, deliveryFeeIls: null },
    ]);
    const preview = previewDeliveryFeeImport({
      shipmentLabel: "SHP-1",
      batch: { batchNumber: "SHP-1", containerNumber: null, sourceShipmentNumber: null },
      fileRows: [
        {
          excelRow: 2,
          customerCode: "40062",
          customerName: null,
          area: null,
          containerNumber: null,
          boxes: 3,
          deliveryFeeIls: 180,
        },
      ],
      systemGroups: groups,
    });
    assert.equal(preview.willUpdateCount, 0);
    assert.equal(preview.noMatchCount, 1);
  });

  it("preview — כפילות בקובץ", () => {
    const preview = previewDeliveryFeeImport({
      shipmentLabel: "SHP-1",
      batch: { batchNumber: "SHP-1", containerNumber: null, sourceShipmentNumber: null },
      fileRows: [
        {
          excelRow: 2,
          customerCode: "40062",
          customerName: null,
          area: null,
          containerNumber: null,
          boxes: 1,
          deliveryFeeIls: 180,
        },
        {
          excelRow: 3,
          customerCode: "40062",
          customerName: null,
          area: null,
          containerNumber: null,
          boxes: 1,
          deliveryFeeIls: 200,
        },
      ],
      systemGroups: new Map(),
    });
    assert.equal(preview.duplicateCount, 2);
    assert.equal(preview.willUpdateCount, 0);
  });
});
