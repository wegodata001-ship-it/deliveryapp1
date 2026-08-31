import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculatePaymentIntentDeduction,
  extractIncludedVatIls,
} from "@/lib/payment-intent-vat";

describe("extractIncludedVatIls", () => {
  it("1000 ILS gross → 847.46 ILS net", () => {
    assert.deepEqual(extractIncludedVatIls(1000), {
      grossIls: 1000,
      netIls: 847.46,
      vatIls: 152.54,
    });
  });

  it("1180 ILS gross → 1000 ILS net", () => {
    assert.deepEqual(extractIncludedVatIls(1180), {
      grossIls: 1180,
      netIls: 1000,
      vatIls: 180,
    });
  });

  it("0 → 0", () => {
    assert.deepEqual(extractIncludedVatIls(0), {
      grossIls: 0,
      netIls: 0,
      vatIls: 0,
    });
  });
});

describe("calculatePaymentIntentDeduction", () => {
  it("1000 ILS at 3 → $282.49 debt deduction", () => {
    assert.deepEqual(
      calculatePaymentIntentDeduction({
        amountNative: 1000,
        currency: "ILS",
        exchangeRate: 3,
      }),
      {
        currency: "ILS",
        grossNative: 1000,
        vatIls: 152.54,
        netNative: 847.46,
        amountUsd: 282.49,
      },
    );
  });

  it("USD is not VAT-adjusted", () => {
    assert.deepEqual(
      calculatePaymentIntentDeduction({
        amountNative: 1000,
        currency: "USD",
        exchangeRate: 3,
      }),
      {
        currency: "USD",
        grossNative: 1000,
        vatIls: 0,
        netNative: 1000,
        amountUsd: 1000,
      },
    );
  });
});
