/**
 * QA: סינון גבייה לפי אמצעי תשלום
 * npx tsx scripts/qa-shipment-payment-method-filter.ts
 */
import assert from "node:assert/strict";
import {
  filterRecordsByPaymentMethod,
  sumCollectedByPaymentMethod,
  sumRecordsCollectedByPaymentMethod,
} from "../src/lib/shipment-payment-method-filter";
import type { ShipmentPaymentLineDto, ShipmentRecordDto } from "../src/app/admin/shipments/types";

function pay(method: string, amountIls: number): ShipmentPaymentLineDto {
  return {
    id: `${method}-${amountIls}`,
    method,
    methodLabel: method,
    amountIls,
    details: null,
    notes: null,
    createdById: null,
    createdByName: null,
    createdAt: new Date().toISOString(),
    updatedById: null,
    updatedByName: null,
    updatedAt: new Date().toISOString(),
  };
}

function rec(
  id: string,
  payments: ShipmentPaymentLineDto[],
  paidAmountIls: number,
): ShipmentRecordDto {
  return {
    id,
    batchId: "b",
    batchNumber: "B1",
    rowIndex: 1,
    customerCode: "1",
    customerName: "A",
    customerPhone: null,
    address: null,
    city: null,
    originalDeliveryLocation: null,
    deliveryLocationId: null,
    locationMatchStatus: null,
    boxes: 1,
    cartonDetails: null,
    weight: null,
    orderAmount: null,
    orderCurrency: null,
    deliveryFeeAmount: 500,
    deliveryFeeCurrency: "ILS",
    deliveryFeeIls: 500,
    zoneId: null,
    zoneName: null,
    courierId: null,
    courierName: null,
    status: "NEW",
    paymentStatus: "PARTIAL",
    notes: null,
    paidAmountIls,
    remainingFeeIls: Math.max(0, 500 - paidAmountIls),
    customerBalanceUsd: 0,
    payments,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const mixed = rec(
  "m1",
  [pay("CASH", 300), pay("BANK_TRANSFER", 200)],
  500,
);
const cashOnly = rec("c1", [pay("CASH", 100)], 100);
const transferOnly = rec("t1", [pay("BANK_TRANSFER", 50)], 50);
const triple = rec(
  "x1",
  [pay("CASH", 10), pay("CREDIT", 20), pay("BIT", 30)],
  60,
);

assert.equal(sumCollectedByPaymentMethod(mixed.payments, "CASH"), 300);
assert.equal(sumCollectedByPaymentMethod(mixed.payments, "BANK_TRANSFER"), 200);
assert.equal(sumCollectedByPaymentMethod(mixed.payments, null), 500);
assert.equal(sumCollectedByPaymentMethod(mixed.payments, ""), 500);

const all = [mixed, cashOnly, transferOnly, triple];
assert.equal(sumRecordsCollectedByPaymentMethod(all, "CASH"), 410);
assert.equal(sumRecordsCollectedByPaymentMethod(all, "BANK_TRANSFER"), 250);
assert.equal(sumRecordsCollectedByPaymentMethod(all, null), 710);

const cashRows = filterRecordsByPaymentMethod(all, "CASH");
assert.deepEqual(
  cashRows.map((r) => r.id).sort(),
  ["c1", "m1", "x1"],
);
assert.equal(filterRecordsByPaymentMethod(all, "BIT").map((r) => r.id).join(), "x1");
assert.equal(filterRecordsByPaymentMethod(all, "").length, 4);

// בחירה מרובה — OR בסינון שורות, סכום משולב מהפירוט
assert.equal(sumCollectedByPaymentMethod(mixed.payments, ["CASH", "BANK_TRANSFER"]), 500);
assert.equal(sumRecordsCollectedByPaymentMethod(all, ["CASH", "BIT"]), 440);
const cashOrBit = filterRecordsByPaymentMethod(all, ["CASH", "BIT"]);
assert.deepEqual(
  cashOrBit.map((r) => r.id).sort(),
  ["c1", "m1", "x1"],
);

console.log("✓ payment method filter QA passed");
