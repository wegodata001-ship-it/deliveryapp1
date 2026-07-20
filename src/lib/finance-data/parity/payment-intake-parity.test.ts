import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comparePaymentIntakeParity } from "./payment-intake-parity";
import type { PaymentIntakeView } from "@/lib/finance-data/view-models";

describe("payment-intake parity compare", () => {
  it("reports full match when legacy and v2 align", () => {
    const v2: PaymentIntakeView = {
      customerId: "c1",
      customerCode: "C1",
      customerName: "Test",
      orders: [
        {
          orderId: "o1",
          orderNumber: "ORD-1",
          customerId: "c1",
          weekCode: "W1",
          amountUsd: 100,
          commissionUsd: 10,
          totalUsd: 110,
          paidUsd: 40,
          openDebtUsd: 70,
          status: "open",
          hasBreakdown: true,
        },
      ],
      methods: [
        {
          id: "m1",
          orderId: "o1",
          orderNumber: "ORD-1",
          paymentMethod: "CASH",
          currency: "USD",
          planned: 70,
          paid: 0,
          remaining: 70,
          status: "open",
        },
      ],
      summary: {
        orderCount: 1,
        totalUsd: 110,
        paidUsd: 40,
        openDebtUsd: 70,
        methodCount: 1,
        methodRemainingUsd: 70,
        methodRemainingIls: 0,
      },
      breakdownMatchesLedger: true,
    };

    const result = comparePaymentIntakeParity({
      customerId: "c1",
      legacyOrders: [
        {
          orderId: "o1",
          orderNumber: "ORD-1",
          customerId: "c1",
          amountUsd: 100,
          commissionUsd: 10,
          totalUsd: 110,
          paidUsd: 40,
          openDebtUsd: 70,
          status: "partial",
          methods: [
            { method: "CASH", currency: "USD", planned: 70, paid: 0, remaining: 70 },
          ],
        },
      ],
      v2,
    });

    assert.equal(result.ordersChecked, 1);
    assert.equal(result.ordersFullMatch, 1);
    assert.equal(result.diffs.length, 0);
  });

  it("flags cent-level open debt gap", () => {
    const v2: PaymentIntakeView = {
      customerId: "c1",
      customerCode: null,
      customerName: "T",
      orders: [
        {
          orderId: "o1",
          orderNumber: "1",
          customerId: "c1",
          weekCode: null,
          amountUsd: 100,
          commissionUsd: 0,
          totalUsd: 100,
          paidUsd: 0,
          openDebtUsd: 100.01,
          status: "open",
          hasBreakdown: false,
        },
      ],
      methods: [],
      summary: {
        orderCount: 1,
        totalUsd: 100,
        paidUsd: 0,
        openDebtUsd: 100.01,
        methodCount: 0,
        methodRemainingUsd: 0,
        methodRemainingIls: 0,
      },
      breakdownMatchesLedger: true,
    };

    const result = comparePaymentIntakeParity({
      customerId: "c1",
      legacyOrders: [
        {
          orderId: "o1",
          orderNumber: "1",
          customerId: "c1",
          amountUsd: 100,
          commissionUsd: 0,
          totalUsd: 100,
          paidUsd: 0,
          openDebtUsd: 100,
          status: "unpaid",
          methods: [],
        },
      ],
      v2,
    });

    assert.ok(result.diffs.some((d) => d.field === "Open Debt"));
    assert.equal(result.ordersFullMatch, 0);
  });
});
