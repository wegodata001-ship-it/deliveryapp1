import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkedCommissionFeeWhere, linkedCreditPaymentWhere } from "@/lib/payment-cancellation-fees";

describe("linkedCommissionFeeWhere", () => {
  it("matches fees by paymentId or capture code and skips already cancelled", () => {
    const where = linkedCommissionFeeWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1", "fee-pay-1"],
      paymentCaptureCode: "TR-P-000006",
    });
    assert.equal(where.customerId, "cust-1");
    assert.deepEqual(where.status, { not: "CANCELLED" });
    assert.ok(Array.isArray(where.OR));
    assert.ok(
      where.OR?.some((clause) => JSON.stringify(clause).includes("pay-1")),
    );
    assert.ok(
      where.OR?.some((clause) => JSON.stringify(clause).includes("TR-P-000006")),
    );
  });
});

describe("linkedCreditPaymentWhere", () => {
  it("requires CUSTOMER_CREDIT and an explicit capture key", () => {
    const where = linkedCreditPaymentWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1"],
      paymentNumber: 6,
      paymentCaptureCode: "TR-P-000006",
    });
    assert.ok(Array.isArray(where.AND));
    assert.ok(JSON.stringify(where).includes("CUSTOMER_CREDIT"));
    assert.ok(JSON.stringify(where).includes("pay-1"));
    assert.ok(!JSON.stringify(where).includes("קשור לקליטה"));
  });
});
