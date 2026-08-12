import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeCreateShipmentRecordInput,
  shipmentRecordToDuplicateBaseline,
  validateMergedCreateShipmentRecord,
} from "@/lib/shipment-record-duplicate";
import type { ShipmentRecordDto } from "@/app/admin/shipments/types";

function sampleRecord(overrides: Partial<ShipmentRecordDto> = {}): ShipmentRecordDto {
  return {
    id: "rec-1",
    batchId: "batch-1",
    batchNumber: "SHP-013",
    rowIndex: 1,
    customerCode: "12852",
    customerName: "nihaya ibrahim isawi",
    customerPhone: "972506067456",
    customerPhone2: null,
    address: "kofr Manda",
    city: "kofr Manda",
    originalDeliveryLocation: "kofr Manda",
    updatedDeliveryLocation: "כפר מנדא",
    deliveryLocationId: "loc-1",
    locationMatchStatus: "MATCHED",
    boxes: 6,
    cartonDetails: null,
    weight: 12,
    orderAmount: 100,
    orderCurrency: "USD",
    deliveryFeeAmount: 50,
    deliveryFeeCurrency: "ILS",
    deliveryFeeIls: 50,
    zoneId: "zone-6",
    zoneName: "צפון 6",
    courierId: null,
    courierName: null,
    status: "NEW",
    paymentStatus: "PAID",
    notes: null,
    paidAmountIls: 50,
    remainingFeeIls: 0,
    customerBalanceUsd: 0,
    payments: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("shipmentRecordToDuplicateBaseline", () => {
  it("משתמש במקום מסירה אפקטיבי", () => {
    const baseline = shipmentRecordToDuplicateBaseline(sampleRecord());
    assert.equal(baseline.city, "כפר מנדא");
    assert.equal(baseline.originalDeliveryLocation, "kofr Manda");
    assert.equal(baseline.customerPhone, "972506067456");
    assert.equal(baseline.zoneId, "zone-6");
  });
});

describe("mergeCreateShipmentRecordInput", () => {
  it("משלים שדות חסרים מהמקור", () => {
    const source = shipmentRecordToDuplicateBaseline(sampleRecord());
    const merged = mergeCreateShipmentRecordInput(
      {
        batchId: "batch-1",
        sourceRecordId: "rec-1",
        boxes: 2,
      },
      source,
    );
    assert.equal(merged.customerName, source.customerName);
    assert.equal(merged.customerPhone, source.customerPhone);
    assert.equal(merged.city, source.city);
    assert.equal(merged.boxes, 2);
  });
});

describe("validateMergedCreateShipmentRecord", () => {
  it("נכשל כששדה שהיה במקור נעלם", () => {
    const source = shipmentRecordToDuplicateBaseline(sampleRecord());
    assert.throws(
      () =>
        validateMergedCreateShipmentRecord(
          {
            batchId: "batch-1",
            customerName: "test",
            customerPhone: null,
          },
          source,
        ),
      /טלפון חסר/,
    );
  });
});
