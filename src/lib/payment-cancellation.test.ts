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

describe("TEST 7 — ביטול תשלום יתר מבטל גם Fee וגם Credit", () => {
  it("שאילתת הביטול תופסת גם תנועת עמלה וגם יתרת זכות של אותה קליטה", () => {
    const feeWhere = linkedCommissionFeeWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1", "fee-pay-1"],
      paymentCaptureCode: "TR-P-000200",
    });
    const creditWhere = linkedCreditPaymentWhere({
      customerId: "cust-1",
      paymentIds: ["pay-1", "credit-pay-1"],
      paymentNumber: 200,
      paymentCaptureCode: "TR-P-000200",
    });
    assert.deepEqual(feeWhere.status, { not: "CANCELLED" });
    assert.ok(JSON.stringify(feeWhere).includes("TR-P-000200"));
    assert.ok(JSON.stringify(creditWhere).includes("CUSTOMER_CREDIT"));
    assert.ok(JSON.stringify(creditWhere).includes("TR-P-000200"));
    assert.ok(JSON.stringify(creditWhere).includes("not"));
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
