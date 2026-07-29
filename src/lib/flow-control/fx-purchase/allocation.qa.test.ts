/**
 * QA — FIFO allocation for FX purchase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateFxIntakeReceipts,
} from "@/lib/flow-control/fx-purchase/allocation";
import type { FxIntakeReceipt } from "@/lib/flow-control/fx-purchase/types";

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
});
