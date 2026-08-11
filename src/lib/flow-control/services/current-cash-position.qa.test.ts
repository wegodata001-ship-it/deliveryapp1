/**
 * QA — יתרות חיוביות/שליליות, Ledger, קיזוז חוב בנק.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLedgerDelta,
  computeCurrentCashPosition,
  computeNetAvailableIls,
} from "@/lib/flow-control/services/current-cash-position.shared";
import type { CurrentBalanceTrackBreakdown } from "@/lib/flow-control/services/current-financial-balances-types";

const zeroTrack = (): CurrentBalanceTrackBreakdown => ({
  purchased: 0,
  transferred: 0,
  commission: 0,
  available: 0,
});

function pos(overrides: Partial<Parameters<typeof computeCurrentCashPosition>[0]>) {
  return computeCurrentCashPosition({
    grossAvailableIls: 0,
    bankBalanceIls: 0,
    fxPurchasesPsIls: 0,
    fxPurchasesIlIls: 0,
    psFxBalance: zeroTrack(),
    ilFxBalance: zeroTrack(),
    turkeyFxBalanceUsd: 0,
    fxAvailableForTransferUsd: 0,
    totalFxUsd: 0,
    ...overrides,
  });
}

describe("QA: Ledger — יתרה שלילית נשמרת", () => {
  it("-50,000 + 50,000 = 0", () => {
    assert.equal(applyLedgerDelta(-50_000, 50_000), 0);
  });

  it("-50,000 + 30,000 = -20,000", () => {
    assert.equal(applyLedgerDelta(-50_000, 30_000), -20_000);
  });

  it("-50,000 + 60,000 = +10,000", () => {
    assert.equal(applyLedgerDelta(-50_000, 60_000), 10_000);
  });

  it("-5,000 + 10,000 = +5,000", () => {
    assert.equal(applyLedgerDelta(-5_000, 10_000), 5_000);
  });
});

describe("QA: נוסחאות בסיס", () => {
  it("100,000 - 15,000 = 85,000 ברוטו", () => {
    assert.equal(applyLedgerDelta(100_000, -15_000), 85_000);
  });

  it("100,000 - 15,000 - 50,000 חוב בנק = 35,000 נטו", () => {
    const gross = applyLedgerDelta(100_000, -15_000);
    assert.equal(gross, 85_000);
    assert.equal(computeNetAvailableIls(gross, -50_000), 35_000);
  });
});

describe("QA: תרחיש רכישת מט״ח + כיסוי חוב", () => {
  it("בנק נשאר -50,000 עד כניסה; נטו 35,000; מט״ח נפרד", () => {
    const gross = 85_000;
    const bank = -50_000;
    const position = pos({
      grossAvailableIls: gross,
      bankBalanceIls: bank,
      fxPurchasesPsIls: 15_000,
      fxPurchasesIlIls: 0,
      psFxBalance: { purchased: 100, transferred: 0, commission: 0, available: 100 },
    });

    assert.equal(position.grossAvailableIls, 85_000);
    assert.equal(position.bankBalanceIls, -50_000);
    assert.equal(position.bankStatus, "debt");
    assert.equal(position.netAvailableIls, 35_000);
    assert.equal(position.netStatus, "available");
    assert.equal(position.debtCoverageFromCashIls, 50_000);
    assert.equal(position.effectiveBankBalanceIls, 0);
    assert.equal(position.fxPurchasesIls, 15_000);
    assert.equal(position.psFxBalance.purchased, 100);
  });
});

describe("QA: כניסה לבנק סוגרת חוב — לא מתחיל מאפס", () => {
  it("בנק -50,000 + הפקדה 50,000 → בנק 0", () => {
    const bank = applyLedgerDelta(-50_000, 50_000);
    const position = pos({ bankBalanceIls: bank, grossAvailableIls: 0 });
    assert.equal(position.bankBalanceIls, 0);
    assert.equal(position.bankStatus, "balanced");
    assert.equal(position.netAvailableIls, 0);
  });

  it("בנק -20,000 אחרי 30,000 על -50,000", () => {
    const bank = applyLedgerDelta(-50_000, 30_000);
    const position = pos({ bankBalanceIls: bank });
    assert.equal(position.bankBalanceIls, -20_000);
    assert.equal(position.bankStatus, "debt");
  });

  it("בנק +10,000 אחרי 60,000 על -50,000", () => {
    const bank = applyLedgerDelta(-50_000, 60_000);
    const position = pos({ bankBalanceIls: bank });
    assert.equal(position.bankBalanceIls, 10_000);
    assert.equal(position.bankStatus, "available");
  });
});
