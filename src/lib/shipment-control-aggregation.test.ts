import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateShipmentFinancials,
  countMissingShipmentDeliveryFees,
  sumShipmentBalances,
} from "@/lib/shipment-control-aggregation";

describe("aggregateShipmentFinancials", () => {
  it("splits composite payments by method and computes both balances", () => {
    const r = aggregateShipmentFinancials(
      [
        {
          batchId: "b1",
          deliveryFeeIls: 10400,
          payments: [
            { method: "CASH", amountIls: 500 },
            { method: "BANK_TRANSFER", amountIls: 300 },
            { method: "CASH", amountIls: 4500 },
            { method: "BANK_TRANSFER", amountIls: 2700 },
            { method: "CHECK", amountIls: 1000 },
          ],
        },
      ],
      [{ batchId: "b1", amount: 2500, currency: "ILS" }],
    );

    assert.equal(r.shipmentTotalDeliveryFees, 10400);
    assert.equal(r.shipmentCashReceived, 5000);
    assert.equal(r.shipmentTransferReceived, 3000);
    assert.equal(r.shipmentCheckReceived, 1000);
    assert.equal(r.shipmentReceived, 9000);
    assert.equal(r.shipmentExpenses, 2500);
    assert.equal(r.shipmentOutstandingDeliveryFees, 1400); // 10400 - 9000
    assert.equal(r.shipmentBalance, 6500); // 9000 - 2500
  });

  it("does not double-count a single payment across method columns", () => {
    const r = aggregateShipmentFinancials([
      {
        batchId: "b1",
        deliveryFeeIls: 1000,
        payments: [{ method: "CASH", amountIls: 1000 }],
      },
    ]);
    assert.equal(r.shipmentCashReceived, 1000);
    assert.equal(r.shipmentTransferReceived, 0);
    assert.equal(r.shipmentCheckReceived, 0);
    assert.equal(r.shipmentOutstandingDeliveryFees, 0);
  });

  it("ignores USD expenses in ILS balance", () => {
    const r = aggregateShipmentFinancials(
      [
        {
          batchId: "b1",
          deliveryFeeIls: 100,
          payments: [{ method: "CASH", amountIls: 100 }],
        },
      ],
      [
        { batchId: "b1", amount: 20, currency: "ILS" },
        { batchId: "b1", amount: 50, currency: "USD" },
      ],
    );
    assert.equal(r.shipmentExpenses, 20);
    assert.equal(r.shipmentBalance, 80);
  });

  it("sums shipment balances across batches for KPI", () => {
    const total = sumShipmentBalances(
      [
        {
          batchId: "b1",
          deliveryFeeIls: 1000,
          payments: [{ method: "CASH", amountIls: 800 }],
        },
        {
          batchId: "b2",
          deliveryFeeIls: 500,
          payments: [{ method: "BANK_TRANSFER", amountIls: 500 }],
        },
      ],
      [
        { batchId: "b1", amount: 100, currency: "ILS" },
        { batchId: "b2", amount: 50, currency: "ILS" },
      ],
    );
    // b1: 800-100=700, b2: 500-50=450 → 1150
    assert.equal(total, 1150);
  });

  it("includes record expenses in the same balance SSOT", () => {
    const r = aggregateShipmentFinancials(
      [{
        batchId: "b1",
        deliveryFeeIls: 1000,
        expensesTotalIls: 75,
        payments: [{ method: "CASH", amountIls: 800 }],
      }],
      [{ batchId: "b1", amount: 25, currency: "ILS" }],
    );
    assert.equal(r.shipmentExpenses, 100);
    assert.equal(r.shipmentBalance, 700);
  });

  it("counts missing fees while accepting a positive original-currency fee", () => {
    assert.equal(
      countMissingShipmentDeliveryFees([
        { deliveryFeeIls: null, deliveryFeeAmount: null },
        { deliveryFeeIls: 0, deliveryFeeAmount: 0 },
        { deliveryFeeIls: 120, deliveryFeeAmount: 120 },
        { deliveryFeeIls: null, deliveryFeeAmount: 50 },
      ]),
      2,
    );
  });
});
