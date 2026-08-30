import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSurplusFeeTargetOrderId } from "@/lib/payment-surplus-fee-order";

describe("resolveSurplusFeeTargetOrderId", () => {
  it("prefers last allocated order", () => {
    assert.equal(
      resolveSurplusFeeTargetOrderId({
        allocationOrderIds: ["a", "b"],
        includedOrderIds: ["z"],
        intakeOrderIdsOldestFirst: ["a", "b", "z"],
        fallbackNewestOrderId: "z",
      }),
      "b",
    );
  });

  it("falls back to last included intake order when no allocation", () => {
    assert.equal(
      resolveSurplusFeeTargetOrderId({
        allocationOrderIds: [],
        includedOrderIds: ["a", "b"],
        intakeOrderIdsOldestFirst: ["a", "b", "c"],
        fallbackNewestOrderId: "c",
      }),
      "b",
    );
  });

  it("uses newest customer order when intake empty", () => {
    assert.equal(
      resolveSurplusFeeTargetOrderId({
        allocationOrderIds: [],
        includedOrderIds: null,
        intakeOrderIdsOldestFirst: [],
        fallbackNewestOrderId: "newest",
      }),
      "newest",
    );
  });
});
