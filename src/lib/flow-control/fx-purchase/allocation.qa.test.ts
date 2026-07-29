/**
 * QA — FIFO allocation for FX purchase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateFxIntakeReceipts,
  appendCashControlPoolReceipt,
} from "@/lib/flow-control/fx-purchase/allocation";
import type { CashControlSnapshot, FxIntakeReceipt } from "@/lib/flow-control/fx-purchase/types";

function receipt(id: string, remainingIls: number): FxIntakeReceipt {
  return {
    paymentId: id,
    orderId: null,
    orderNumber: null,
    dateYmd: "2026-07-28",
    dateLabel: "28/07/2026",
    sourceLabel: id,
    grossIls: remainingIls,
    consumedIls: 0,
    remainingIls,
    intakeRate: 3.5,
  };
}

describe("QA: FX FIFO allocation", () => {
  it("יתרה מדויקת — אין shortfall", () => {
    const preview = allocateFxIntakeReceipts([receipt("p1", 2000)], 2000, 3.5);
    assert.equal(preview.shortfallIls, 0);
    assert.equal(preview.lines[0]?.ilsAmount, 2000);
  });

  it("יתרה נמוכה — shortfall מדויק", () => {
    const preview = allocateFxIntakeReceipts([receipt("p1", 1900)], 2000, 3.5);
    assert.equal(preview.shortfallIls, 100);
  });

  it("FIFO — מספר תקבולים", () => {
    const preview = allocateFxIntakeReceipts(
      [receipt("p1", 500), receipt("p2", 700), receipt("p3", 900)],
      1500,
      3.5,
    );
    assert.equal(preview.shortfallIls, 0);
    assert.equal(preview.lines.length, 3);
    assert.equal(preview.lines[2]?.ilsAmount, 300);
  });

  it("יתרה מספירת קופה ללא תקבולי Payment — אין shortfall", () => {
    const snapshot: CashControlSnapshot = {
      weekCode: "AH-200",
      countedCashIls: 1234,
      countedCashUsd: 0,
      countedTransferIls: 0,
      countedCreditIls: 0,
      countedChecksIls: 0,
      commissionUsd: 0,
      commissionIls: 0,
      fxPurchases: [],
    };
    const receipts = appendCashControlPoolReceipt([], snapshot, "PS");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.remainingIls, 1234);
    const preview = allocateFxIntakeReceipts(receipts, 1234, 3.5);
    assert.equal(preview.shortfallIls, 0);
    assert.equal(preview.lines[0]?.sourceLabel, "מזומן PS — ספירת קופה");
  });
});
