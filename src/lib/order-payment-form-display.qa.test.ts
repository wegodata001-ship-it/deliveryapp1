import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPOSITE_PM } from "@/lib/payment-breakdown-shared";
import {
  ORDER_PAYMENT_FORM_UNPAID_LABEL,
  ORDER_PAYMENT_FORM_UNKNOWN_LABEL,
  resolveOrderPaymentFormDisplay,
} from "@/lib/order-payment-form-display";

describe("resolveOrderPaymentFormDisplay", () => {
  it("no payment → לא שולם", () => {
    const r = resolveOrderPaymentFormDisplay({});
    assert.equal(r.kind, "unpaid");
    assert.equal(r.displayLabel, ORDER_PAYMENT_FORM_UNPAID_LABEL);
  });

  it("single CASH breakdown → מזומן", () => {
    const r = resolveOrderPaymentFormDisplay({
      orderPaymentMethod: COMPOSITE_PM,
      breakdownLines: [{ paymentMethod: "CASH", amount: 100, currency: "USD" }],
    });
    assert.equal(r.kind, "single");
    assert.equal(r.displayLabel, "מזומן");
    assert.equal(r.displayKey, "CASH");
  });

  it("cash USD + cash ILS → still מזומן (one method)", () => {
    const r = resolveOrderPaymentFormDisplay({
      orderPaymentMethod: COMPOSITE_PM,
      breakdownLines: [
        { paymentMethod: "CASH", amount: 100, currency: "USD" },
        { paymentMethod: "CASH", amount: 300, currency: "ILS" },
      ],
    });
    assert.equal(r.kind, "single");
    assert.equal(r.displayLabel, "מזומן");
  });

  it("cash + bank transfer → תשלום מורכב with tooltip", () => {
    const r = resolveOrderPaymentFormDisplay({
      orderPaymentMethod: COMPOSITE_PM,
      breakdownLines: [
        { paymentMethod: "CASH", amount: 100, currency: "USD" },
        { paymentMethod: "BANK_TRANSFER", amount: 100, currency: "USD" },
      ],
    });
    assert.equal(r.kind, "composite");
    assert.equal(r.displayLabel, "תשלום מורכב");
    assert.equal(r.displayKey, COMPOSITE_PM);
    assert.ok(r.tooltipLines.some((l) => l.includes("מזומן")));
    assert.ok(r.tooltipLines.some((l) => l.includes("העברה")));
  });

  it("ILS cash + USD transfer → composite", () => {
    const r = resolveOrderPaymentFormDisplay({
      orderPaymentMethod: COMPOSITE_PM,
      breakdownLines: [
        { paymentMethod: "CASH", amount: 100, currency: "ILS" },
        { paymentMethod: "BANK_TRANSFER", amount: 50, currency: "USD" },
      ],
    });
    assert.equal(r.kind, "composite");
    assert.equal(r.displayLabel, "תשלום מורכב");
  });

  it("allocations with two methods → composite", () => {
    const r = resolveOrderPaymentFormDisplay({
      allocationLines: [
        { method: "CASH", currency: "USD", sourceAmount: 100 },
        { method: "BANK_TRANSFER", currency: "USD", sourceAmount: 50 },
      ],
      hasPaymentActivity: true,
    });
    assert.equal(r.kind, "composite");
    assert.equal(r.displayKey, COMPOSITE_PM);
  });

  it("payment activity but missing method → unknown", () => {
    const r = resolveOrderPaymentFormDisplay({
      hasPaymentActivity: true,
      orderPaymentMethod: "",
    });
    assert.equal(r.kind, "unknown");
    assert.equal(r.displayLabel, ORDER_PAYMENT_FORM_UNKNOWN_LABEL);
  });
});
