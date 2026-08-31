import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderCommissionDetailView,
  computeOrderCommissionBreakdown,
  summarizeCustomerOrderCommissions,
} from "@/lib/order-commission-ssot";
import { formatCommissionEquation } from "@/lib/commission-lineage-view";

describe("computeOrderCommissionBreakdown", () => {
  it("START $10 + overpayment +$5 → current $15", () => {
    const b = computeOrderCommissionBreakdown({
      orderId: "o1",
      baseCommissionUsd: 10,
      fees: [{ amountUsd: 5, userChoice: "commission" }],
    });
    assert.equal(b.baseCommissionUsd, 10);
    assert.equal(b.adjustmentsUsd, 5);
    assert.equal(b.currentCommissionUsd, 15);
    assert.equal(b.hasAdjustments, true);
  });

  it("then reset -$4 → current $11", () => {
    const b = computeOrderCommissionBreakdown({
      orderId: "o1",
      baseCommissionUsd: 10,
      fees: [
        { amountUsd: 5, userChoice: "commission" },
        { amountUsd: -4, userChoice: "commission_pool_debit" },
      ],
    });
    assert.equal(b.currentCommissionUsd, 11);
    assert.equal(b.adjustmentsUsd, 1);
  });

  it("allows negative current fee", () => {
    const b = computeOrderCommissionBreakdown({
      orderId: "o1",
      baseCommissionUsd: 3,
      fees: [{ amountUsd: -5, userChoice: "commission_pool_debit" }],
    });
    assert.equal(b.currentCommissionUsd, -2);
  });

  it("skips legacy fee_adjustment_negative (already in base)", () => {
    const b = computeOrderCommissionBreakdown({
      orderId: "o1",
      baseCommissionUsd: 8,
      fees: [{ amountUsd: -2, userChoice: "fee_adjustment_negative" }],
    });
    assert.equal(b.currentCommissionUsd, 8);
    assert.equal(b.hasAdjustments, false);
  });

  it("unchanged fee has no adjustments", () => {
    const b = computeOrderCommissionBreakdown({
      orderId: "o1",
      baseCommissionUsd: 82.6,
      fees: [],
    });
    assert.equal(b.currentCommissionUsd, 82.6);
    assert.equal(b.hasAdjustments, false);
  });
});

describe("buildOrderCommissionDetailView", () => {
  it("lists movements and totals", () => {
    const d = buildOrderCommissionDetailView({
      orderId: "o1",
      orderNumber: "TR-1",
      baseCommissionUsd: 10,
      fees: [
        {
          id: "f1",
          amountUsd: 5,
          userChoice: "commission",
          createdAt: "2026-08-30T09:40:00.000Z",
          paymentCaptureCode: "TR-P-9",
          createdByName: "Admin",
        },
        {
          id: "f2",
          amountUsd: -4,
          userChoice: "commission_pool_debit",
          createdAt: "2026-08-30T10:00:00.000Z",
        },
      ],
    });
    assert.equal(d.movements.length, 3);
    assert.equal(d.currentCommissionUsd, 11);
    assert.equal(d.movements[0]!.label, "עמלה מקורית");
    assert.equal(d.movements[0]!.amountUsd, 10);
    assert.equal(d.movements[1]!.label, "תוספת עמלה");
    assert.equal(d.movements[1]!.paymentCode, "TR-P-9");
    assert.equal(d.movements[1]!.amountUsd, 5);
    assert.equal(d.movements[2]!.label, "הפחתת עמלה");
    assert.equal(d.movements[2]!.amountUsd, -4);
    assert.equal(
      formatCommissionEquation(d.movements.map((m) => m.amountUsd)),
      "$10 + $5 − $4 = $11",
    );
  });
});

describe("summarizeCustomerOrderCommissions", () => {
  it("rolls up base/adjustments/current", () => {
    const s = summarizeCustomerOrderCommissions([
      computeOrderCommissionBreakdown({
        orderId: "a",
        baseCommissionUsd: 82.6,
        fees: [{ amountUsd: 5, userChoice: "commission" }],
      }),
      computeOrderCommissionBreakdown({
        orderId: "b",
        baseCommissionUsd: 8.4,
        fees: [],
      }),
      computeOrderCommissionBreakdown({
        orderId: "c",
        baseCommissionUsd: 21,
        fees: [],
      }),
    ]);
    assert.equal(s.baseUsd, 112);
    assert.equal(s.adjustmentsUsd, 5);
    assert.equal(s.currentUsd, 117);
  });
});
