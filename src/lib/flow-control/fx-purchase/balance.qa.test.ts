/**
 * QA — SSOT balance + gate for FX purchase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availableIlsForTrack,
  computeFxAvailableBalances,
  evaluateFxPurchaseGate,
} from "@/lib/flow-control/fx-purchase/balance.shared";
import type { CashControlSnapshot } from "@/lib/flow-control/fx-purchase/types";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";

function fx(
  ilsAmount: number,
  track: "PS" | "IL" = "PS",
  remainderCashIls = 0,
  remainderBankIls = 0,
): FxPurchaseRecord {
  return {
    id: `fx-${track}-${ilsAmount}-${remainderBankIls}`,
    track,
    ilsAmount,
    usdReceived: ilsAmount / 3.5,
    rate: 3.5,
    remainderCashIls,
    remainderBankIls,
    createdAt: new Date().toISOString(),
  };
}

function snapshot(
  overrides: Partial<CashControlSnapshot> = {},
): CashControlSnapshot {
  return {
    weekCode: "AH-200",
    countedCashIls: 0,
    countedCashUsd: 0,
    countedTransferIls: 0,
    countedCreditIls: 0,
    countedChecksIls: 0,
    commissionUsd: 0,
    commissionIls: 0,
    fxPurchases: [],
    ...overrides,
  };
}

describe("QA: FX purchase SSOT balance", () => {
  it("יתרה מדויקת בגובה הרכישה — עובר", () => {
    const balances = computeFxAvailableBalances(snapshot({ countedCashIls: 2000 }));
    const gate = evaluateFxPurchaseGate(balances.psCash, 2000);
    assert.equal(gate.ok, true);
  });

  it("יתרה נמוכה — נחסם עם קיים/נדרש/חסר", () => {
    const balances = computeFxAvailableBalances(snapshot({ countedCashIls: 1900 }));
    const gate = evaluateFxPurchaseGate(balances.psCash, 2000);
    assert.equal(gate.ok, false);
    assert.equal(gate.shortfall, 100);
    assert.match(gate.error ?? "", /קיים:/);
  });

  it("אחרי IL remainderBank — PS לא מקבל את ההחזרה", () => {
    const balances = computeFxAvailableBalances(
      snapshot({
        countedCashIls: 100,
        countedTransferIls: 2000,
        fxPurchases: [fx(100, "IL", 0, 1900)],
      }),
    );
    assert.equal(balances.psCash, 100);
    assert.equal(availableIlsForTrack(balances, "PS"), 100);
  });

  it("IL track uses transfer pool only", () => {
    const balances = computeFxAvailableBalances(
      snapshot({
        countedTransferIls: 5000,
        countedCreditIls: 1000,
        fxPurchases: [fx(600, "IL")],
      }),
    );
    assert.equal(balances.ilTransfers, 5400);
  });
});
