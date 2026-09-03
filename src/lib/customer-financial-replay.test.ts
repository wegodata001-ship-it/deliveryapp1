import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayCustomerLedgerRunning } from "@/lib/ledger-running-replay";
import {
  groupAuditsByResetOperation,
  resetOperationAffectsRunningDebt,
  resetOperationId,
} from "@/lib/ledger-reset-grouping";
import {
  projectCustomerCommissionMovements,
  sumActiveCommissionMovementUsd,
} from "@/lib/customer-commission-movements";

describe("debt withdrawal running — floor at $0", () => {
  it("עומר: משיכה $252.50 אחרי הזמנות ותשלום מלא → running $0 לא שלילי", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 1656.4 },
      { kind: "CHARGE", amountUsd: 2626 },
      { kind: "WITHDRAWAL", amountUsd: 252.5 },
      { kind: "PAYMENT", amountUsd: 4282.4 },
    ]);
    assert.deepEqual(replay.balances, [1656.4, 4282.4, 4282.4, 0]);
    assert.equal(replay.balances.at(-1), 0);
    assert.ok(replay.balances.every((b) => b >= 0));
  });

  it("כאמל: משיכה $1,212 נסגרת אחרי תשלומים → $0", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 848.4 },
      { kind: "CHARGE", amountUsd: 2121 },
      { kind: "CHARGE", amountUsd: 8342.6 },
      { kind: "WITHDRAWAL", amountUsd: 1212 },
      { kind: "PAYMENT", amountUsd: 6158.19 },
      { kind: "PAYMENT", amountUsd: 2412.43 },
      { kind: "PAYMENT", amountUsd: 1529.38 },
    ]);
    assert.equal(replay.balances.at(-1), 0);
    assert.ok(replay.balances.every((b) => b >= -0.001));
  });

  it("משיכה לא הופכת עודף לזכות", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 100 },
      { kind: "PAYMENT", amountUsd: 100 },
      { kind: "WITHDRAWAL", amountUsd: 40 },
    ]);
    assert.equal(replay.balances.at(-1), 0);
    assert.equal(replay.pendingWithdrawalUsd, 40);
  });
});

describe("fee movements = fee SSOT", () => {
  it("כולל עמלת הזמנת משיכה — עומר $62.50", () => {
    const movements = projectCustomerCommissionMovements({
      customerId: "c-102",
      orders: [
        {
          id: "o1",
          orderNumber: "TR-134-0002",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T05:55:00Z"),
          commissionUsd: 16.4,
        },
        {
          id: "o2",
          orderNumber: "TR-134-0004",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T06:36:00Z"),
          commissionUsd: 26,
        },
        {
          id: "dw",
          orderNumber: "TR-134-0016",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T07:23:00Z"),
          commissionUsd: 2.5,
        },
      ],
      fees: [
        {
          id: "f1",
          orderId: null,
          paymentId: "p1",
          paymentCaptureCode: "TR-P-000002",
          sourceDocumentCode: null,
          amountUsd: 17.6,
          reason: "PAYMENT_SURPLUS",
          userChoice: "commission",
          notes: null,
          status: "OPEN",
          createdAt: new Date("2026-08-26T10:15:00Z"),
          createdById: null,
          payment: { paymentCode: "TR-P-000002" },
        },
      ],
    });
    assert.equal(sumActiveCommissionMovementUsd(movements), 62.5);
    assert.equal(movements.at(-1)?.balanceAfterUsd, 62.5);
    assert.ok(movements.some((m) => m.sourceDocument === "TR-134-0016" && m.amountUsd === 2.5));
  });

  it("כולל עמלת משיכה — כאמל $124.62", () => {
    const movements = projectCustomerCommissionMovements({
      customerId: "c-105",
      orders: [
        {
          id: "a",
          orderNumber: "TR-134-0005",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T06:36:00Z"),
          commissionUsd: 8.4,
        },
        {
          id: "b",
          orderNumber: "TR-134-0011",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T06:40:00Z"),
          commissionUsd: 21,
        },
        {
          id: "c",
          orderNumber: "TR-137-0004",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T05:49:00Z"),
          commissionUsd: 82.6,
        },
        {
          id: "dw",
          orderNumber: "TR-137-0005",
          orderDate: new Date("2026-08-02"),
          createdAt: new Date("2026-08-26T07:06:00Z"),
          commissionUsd: 12,
        },
      ],
      fees: [
        {
          id: "f",
          orderId: null,
          paymentId: "p",
          paymentCaptureCode: "TR-P-000014",
          sourceDocumentCode: null,
          amountUsd: 0.62,
          reason: "PAYMENT_SURPLUS",
          userChoice: "commission",
          notes: null,
          status: "OPEN",
          createdAt: new Date("2026-09-02T12:38:00Z"),
          createdById: null,
        },
      ],
    });
    assert.equal(sumActiveCommissionMovementUsd(movements), 124.62);
    assert.equal(movements.at(-1)?.balanceAfterUsd, 124.62);
  });

  it("cancelled fee נשמר בהיסטוריה ולא ב-current", () => {
    const movements = projectCustomerCommissionMovements({
      customerId: "c-fee",
      orders: [
        {
          id: "o",
          orderNumber: "TR-1",
          orderDate: new Date("2026-08-01"),
          createdAt: new Date("2026-08-01"),
          commissionUsd: 10,
        },
      ],
      fees: [
        {
          id: "open",
          orderId: null,
          paymentId: "p1",
          paymentCaptureCode: "TR-P-1",
          sourceDocumentCode: null,
          amountUsd: 5,
          reason: "PAYMENT_SURPLUS",
          userChoice: "commission",
          notes: null,
          status: "OPEN",
          createdAt: new Date("2026-08-02"),
          createdById: null,
        },
        {
          id: "can",
          orderId: null,
          paymentId: "p2",
          paymentCaptureCode: "TR-P-2",
          sourceDocumentCode: null,
          amountUsd: 100,
          reason: "PAYMENT_SURPLUS",
          userChoice: "commission",
          notes: null,
          status: "CANCELLED",
          createdAt: new Date("2026-08-03"),
          createdById: null,
        },
      ],
    });
    assert.equal(movements.length, 3);
    assert.equal(movements.filter((m) => m.isCancelled).length, 1);
    assert.equal(sumActiveCommissionMovementUsd(movements), 15);
    assert.equal(movements.at(-1)?.balanceAfterUsd, 15);
    assert.equal(movements.at(-1)?.isCancelled, true);
  });
});

describe("reset grouping — one financial effect", () => {
  const createdAt = new Date("2026-08-31T10:43:16.280Z");

  it("שלושה audit records באותה פעולה חולקים operationId", () => {
    const audits = [
      { id: "1", actionType: "ORDER_COMMISSION_RESET", createdAt, metadata: { orderAmountUnchanged: true } },
      {
        id: "2",
        actionType: "ORDER_BALANCE_RESET",
        createdAt,
        metadata: { orderAmountUnchanged: true, performedAt: "2026-08-31T10:43:15.540Z" },
      },
      { id: "3", actionType: "CUSTOMER_BALANCES_RESET", createdAt, metadata: { totalResetUsd: "0.33" } },
    ];
    const groups = groupAuditsByResetOperation(audits);
    assert.equal(groups.size, 1);
    assert.equal(groups.get(resetOperationId(audits[0]!))?.length, 3);
  });

  it("אימאן: orderAmountUnchanged → אין השפעה כפולה על running debt", () => {
    const affects = resetOperationAffectsRunningDebt({
      audits: [
        { metadata: { orderAmountUnchanged: true } },
        { metadata: { totalResetUsd: "0.33" } },
      ],
      draftAffectsRunningBalance: true,
    });
    assert.equal(affects, false);

    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 8787 },
      { kind: "PAYMENT", amountUsd: 8786.67 },
      { kind: "SKIP", amountUsd: 0.33 },
      { kind: "SKIP", amountUsd: 0.33 },
      { kind: "SKIP", amountUsd: 0.33 },
    ]);
    assert.equal(replay.balances.at(-1), 0.33);
  });

  it("איפוס שכן שינה הזמנה עדיין יכול להשפיע פעם אחת", () => {
    const affects = resetOperationAffectsRunningDebt({
      audits: [{ metadata: { remainingUsd: "50.00" } }],
      draftAffectsRunningBalance: true,
    });
    assert.equal(affects, true);
  });
});

describe("card replay final = SSOT", () => {
  it("שורה-שורה מגיעה ליתרה הסופית בלי דריסת lastRow", () => {
    const replay = replayCustomerLedgerRunning([
      { kind: "CHARGE", amountUsd: 100 },
      { kind: "PAYMENT", amountUsd: 20 },
    ]);
    assert.deepEqual(replay.balances, [100, 80]);
    assert.equal(replay.balances[1], 80);
  });
});
