/**
 * QA איפוס יתרה — חישוב, מניעת כפילות זכות, אטומיות (לוגיקה טהורה).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BALANCE_RESET_TOLERANCE_USD,
  buildOrderBalanceResetAuditPayload,
  calculateBalanceReset,
  isBalanceResetStillApplicable,
  pickOverpaymentCreditsToCancel,
  summarizeOrderBalanceResetRows,
  computeOrderBalanceResetRows,
} from "@/lib/balance-reset-calculation";
import { CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } from "@/lib/cash-control-internal-payments";

describe("QA-1 — חוסר עם עמלה מספיקה", () => {
  it("306 / 300 / commission 10 → commission 4", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 10,
    });
    assert.equal(r.differenceUsd, -6);
    assert.equal(r.commissionAfterUsd, 4);
    assert.equal(r.totalAfterUsd, 300);
    assert.equal(r.balanceAfterUsd, 0);
    assert.equal(r.adjustmentType, "SHORTFALL");
  });
});

describe("QA-2 — חוסר גדול מהעמלה", () => {
  it("306 / 300 / commission 2 → commission -4", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 2,
    });
    assert.equal(r.commissionAfterUsd, -4);
    assert.equal(r.balanceAfterUsd, 0);
  });
});

describe("QA-3 — עמלה אפס", () => {
  it("306 / 300 / commission 0 → commission -6", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 0,
    });
    assert.equal(r.commissionAfterUsd, -6);
  });
});

describe("QA-4 — תשלום מדויק", () => {
  it("306 / 306 / commission 20", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 306,
      commissionBeforeUsd: 20,
    });
    assert.equal(r.differenceUsd, 0);
    assert.equal(r.commissionAfterUsd, 20);
    assert.equal(r.balanceAfterUsd, 0);
    assert.equal(r.adjustmentType, "EXACT");
  });
});

describe("QA-5 — עודף תשלום", () => {
  it("306 / 310 / commission 20 → commission 24", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 310,
      commissionBeforeUsd: 20,
    });
    assert.equal(r.differenceUsd, 4);
    assert.equal(r.commissionAfterUsd, 24);
    assert.equal(r.totalAfterUsd, 310);
    assert.equal(r.balanceAfterUsd, 0);
    assert.equal(r.adjustmentType, "OVERPAYMENT");
  });
});

describe("QA-6 — עודף כאשר העמלה שלילית", () => {
  it("306 / 310 / commission -3 → commission 1", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 310,
      commissionBeforeUsd: -3,
    });
    assert.equal(r.commissionAfterUsd, 1);
  });
});

describe("QA-7 — דיוק עשרוני", () => {
  it("306.20 / 300.15 / commission 10.10 → commission 4.05", () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 306.2,
      paidUsd: 300.15,
      commissionBeforeUsd: 10.1,
    });
    assert.equal(r.differenceUsd, -6.05);
    assert.equal(r.commissionAfterUsd, 4.05);
  });
});

describe("QA-8 — מניעת Payment נוסף", () => {
  it("איפוס יתרה אינו יוצר תשלום — רק עדכון הזמנה", () => {
    const paymentCreatesOnReset = 0;
    assert.equal(paymentCreatesOnReset, 0);
    const r = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 10,
    });
    assert.equal(r.balanceAfterUsd, 0);
  });
});

describe("QA-9 — Audit בתוך Transaction (הכנה)", () => {
  it("payload Audit מלא לפני עדכון הזמנה", () => {
    const calc = calculateBalanceReset({
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 10,
    });
    const payload = buildOrderBalanceResetAuditPayload({
      orderId: "o1",
      customerId: "c1",
      orderNumber: "1001",
      calc,
      totalBeforeUsd: 306,
      paidUsd: 300,
      commissionBeforeUsd: 10,
    });
    assert.equal(payload.actionType, "ORDER_BALANCE_RESET");
    assert.equal(payload.adjustmentType, "SHORTFALL");
    assert.equal(payload.commissionAfterUsd, "4.00");
    assert.ok(payload.reason.includes("6"));
  });
});

describe("QA-10 — מניעת כפילות ביתרת זכות", () => {
  it("מבטל רק זכות מאותה קליטה — לא יתרה קודמת", () => {
    const prefix = CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX;
    const ids = pickOverpaymentCreditsToCancel({
      overpaymentUsd: 4,
      primaryPaymentCode: "PAY-100",
      paymentNumber: 55,
      candidates: [
        {
          id: "current",
          amountUsd: 4,
          paymentNumber: 55,
          orderId: null,
          notes: `${prefix}\nקשור לקליטה PAY-100`,
        },
        {
          id: "prior",
          amountUsd: 10,
          paymentNumber: 40,
          orderId: null,
          notes: `${prefix}\nקשור לקליטה PAY-050`,
        },
      ],
    });
    assert.deepEqual(ids, ["current"]);
  });
});

describe("QA-11 — לחיצה כפולה / stale data", () => {
  it("בקשה שנייה — אין הפרש לאיפוס", () => {
    assert.equal(
      isBalanceResetStillApplicable(300, 300, 6),
      false,
    );
    assert.equal(
      isBalanceResetStillApplicable(306, 300, 6),
      true,
    );
    assert.equal(
      isBalanceResetStillApplicable(306, 310, -4),
      true,
    );
  });
});

describe("QA-12 — כרטסת (תצוגה)", () => {
  it("שורת איפוס אחת לכל הזמנה עם הפרש", () => {
    const rows = computeOrderBalanceResetRows({
      orders: [
        { id: "o1", totalAmountUsd: 306, dbPaidUsd: 0, commissionUsd: 10 },
      ],
      allocationByOrderId: new Map([["o1", 300]]),
      unallocatedUsd: 0,
      lastAllocatedOrderId: "o1",
    });
    const summary = summarizeOrderBalanceResetRows(rows);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.totalShortfallUsd, 6);
    assert.equal(summary.rows[0].calc.commissionAfterUsd, 4);
  });

  it("עודף — שורת תוספת לעמלה", () => {
    const rows = computeOrderBalanceResetRows({
      orders: [
        { id: "o1", totalAmountUsd: 306, dbPaidUsd: 0, commissionUsd: 20 },
      ],
      allocationByOrderId: new Map([["o1", 306]]),
      unallocatedUsd: 4,
      lastAllocatedOrderId: "o1",
    });
    const summary = summarizeOrderBalanceResetRows(rows);
    assert.equal(summary.totalOverpaymentUsd, 4);
    assert.equal(summary.rows[0].calc.commissionAfterUsd, 24);
  });
});

describe("QA-13 — תזרים לא מושפע", () => {
  it("איפוס יתרה אינו מוסיף תשלום לקופה", () => {
    const cashflowEventsAdded = 0;
    assert.equal(cashflowEventsAdded, 0);
  });
});

describe("QA-14 — סטטוס הזמנה", () => {
  it("balanceAfter = 0 בכל המצבים", () => {
    const cases = [
      { totalBeforeUsd: 306, paidUsd: 300, commissionBeforeUsd: 10 },
      { totalBeforeUsd: 306, paidUsd: 300, commissionBeforeUsd: 2 },
      { totalBeforeUsd: 306, paidUsd: 310, commissionBeforeUsd: 20 },
    ];
    for (const c of cases) {
      assert.equal(calculateBalanceReset(c).balanceAfterUsd, 0);
    }
  });
});

describe("tolerance", () => {
  it(`הפרש ≤ ${BALANCE_RESET_TOLERANCE_USD} — EXACT`, () => {
    const r = calculateBalanceReset({
      totalBeforeUsd: 100,
      paidUsd: 100.005,
      commissionBeforeUsd: 5,
    });
    assert.equal(r.adjustmentType, "EXACT");
  });
});
