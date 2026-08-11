import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateManualShipmentPayment } from "@/lib/manual-shipment-payment";

describe("calculateManualShipmentPayment", () => {
  it("computes 17500 - 2500 + (24000 * 0.18) = 19320", () => {
    const r = calculateManualShipmentPayment({
      paymentAmount: 17500,
      ridominAmount: 2500,
      makasaAmount: 24000,
    });
    assert.equal(r.makasaVat, 4320);
    assert.equal(r.payment, 19320);
  });

  it("computes 17500 - 0 + 0 = 17500", () => {
    const r = calculateManualShipmentPayment({
      paymentAmount: 17500,
      ridominAmount: 0,
      makasaAmount: 0,
    });
    assert.equal(r.payment, 17500);
  });

  it("computes 0 - 0 + (10000 * 0.18) = 1800", () => {
    const r = calculateManualShipmentPayment({
      paymentAmount: 0,
      ridominAmount: 0,
      makasaAmount: 10000,
    });
    assert.equal(r.payment, 1800);
  });

  it("returns 0 when all fields empty", () => {
    const r = calculateManualShipmentPayment({
      paymentAmount: null,
      ridominAmount: "",
      makasaAmount: undefined,
    });
    assert.equal(r.payment, 0);
    assert.equal(Number.isNaN(r.payment), false);
  });
});
