import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyOrderPaymentStatusFilter } from "@/lib/order-payment-status-filter";

describe("classifyOrderPaymentStatusFilter", () => {
  it("unpaid / partial / paid / overpaid", () => {
    assert.equal(classifyOrderPaymentStatusFilter({ totalUsd: 100, paidUsd: 0 }), "unpaid");
    assert.equal(classifyOrderPaymentStatusFilter({ totalUsd: 100, paidUsd: 40 }), "partial");
    assert.equal(classifyOrderPaymentStatusFilter({ totalUsd: 100, paidUsd: 100 }), "paid");
    assert.equal(classifyOrderPaymentStatusFilter({ totalUsd: 100, paidUsd: 120 }), "overpaid");
  });
});
