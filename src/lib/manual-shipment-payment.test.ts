import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateManualShipmentBalance } from "@/lib/manual-shipment-payment";

describe("calculateManualShipmentBalance", () => {
  it("computes 17500 + 14200 - 12500 - (25600 * 0.18) = 14592", () => {
    const r = calculateManualShipmentBalance({
      paymentAmount: 17500,
      vatAmount: 14200,
      airjetInvoice: 12500,
      makasaAmount: 25600,
    });
    assert.equal(r.makasaVat, 4608);
    assert.equal(r.balance, 14592);
  });

  it("computes 17500 + 0 - 0 - 0 = 17500", () => {
    const r = calculateManualShipmentBalance({
      paymentAmount: 17500,
      vatAmount: 0,
      airjetInvoice: 0,
      makasaAmount: 0,
    });
    assert.equal(r.balance, 17500);
  });

  it("computes 0 + 0 - 0 - (10000 * 0.18) = -1800", () => {
    const r = calculateManualShipmentBalance({
      paymentAmount: 0,
      vatAmount: 0,
      airjetInvoice: 0,
      makasaAmount: 10000,
    });
    assert.equal(r.balance, -1800);
  });

  it("returns 0 when all fields empty", () => {
    const r = calculateManualShipmentBalance({
      paymentAmount: null,
      vatAmount: "",
      airjetInvoice: undefined,
      makasaAmount: undefined,
    });
    assert.equal(r.balance, 0);
    assert.equal(Number.isNaN(r.balance), false);
  });

  it("parses airjet invoice string with commas", () => {
    const r = calculateManualShipmentBalance({
      paymentAmount: 1000,
      vatAmount: 180,
      airjetInvoice: "1,200",
      makasaAmount: "0",
    });
    assert.equal(r.balance, -20);
  });
});
