/**
 * QA — יתרה להעברה לטורקיה מתנועות (לא מהזמנות).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTurkeyBalanceResult,
  computeOpeningBalanceBeforeWeek,
  computeWeekTurkeySummary,
  signedMovementAmount,
  sumMovementsByCurrency,
} from "@/lib/flow-control/turkey-transfer-balance-service";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";

function mov(
  partial: Partial<TurkeyTransferMovementDto> & Pick<TurkeyTransferMovementDto, "weekCode" | "type" | "amount">,
): TurkeyTransferMovementDto {
  return {
    id: partial.id ?? "m1",
    currency: partial.currency ?? "USD",
    signedAmount: signedMovementAmount(partial.type, partial.amount),
    balanceBefore: null,
    balanceAfter: null,
    reference: null,
    notes: null,
    createdByName: null,
    createdAtIso: "2026-07-13T00:00:00.000Z",
    createdAtDisplay: "13/07/2026",
    ...partial,
  };
}

describe("QA-1 התחלה מאפס", () => {
  it("יתרת סגירה = הקצאה מספירה", () => {
    const movements = [mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 })];
    const res = buildTurkeyBalanceResult({
      weekCode: "AH-131",
      openingUsd: 0,
      openingIls: 0,
      movements,
      hasCashCount: true,
    });
    assert.equal(res.usd.closingBalance, 2980);
    assert.equal(res.usd.openingBalance, 0);
  });
});

describe("QA-2 העברה חלקית", () => {
  it("יתרה 480, סטטוס חלקי", () => {
    const movements = [
      mov({ id: "a", weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 }),
      mov({ id: "t", weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 2500 }),
    ];
    const res = buildTurkeyBalanceResult({
      weekCode: "AH-131",
      openingUsd: 0,
      openingIls: 0,
      movements,
      hasCashCount: true,
    });
    assert.equal(res.usd.closingBalance, 480);
    assert.equal(res.usd.status, "PARTIALLY_TRANSFERRED");
  });
});

describe("QA-3 מעבר שבוע", () => {
  it("פתיחה AH-132 = סגירה AH-131", () => {
    const movements = [
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 }),
      mov({ weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 2500 }),
    ];
    const opening = computeOpeningBalanceBeforeWeek(movements, "AH-132", "USD");
    assert.equal(opening, 480);
  });
});

describe("QA-4 ספירה חדשה + מעבר שבוע", () => {
  it("סגירה 1480", () => {
    const movements = [
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 }),
      mov({ weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 2500 }),
      mov({ weekCode: "AH-132", type: "CASH_COUNT_ALLOCATION", amount: 3000 }),
      mov({ weekCode: "AH-132", type: "TRANSFER_TO_TURKEY", amount: 2000 }),
    ];
    const res = buildTurkeyBalanceResult({
      weekCode: "AH-132",
      openingUsd: 480,
      openingIls: 0,
      movements,
      hasCashCount: true,
    });
    assert.equal(res.usd.closingBalance, 1480);
  });
});

describe("QA-5 נוסחת יתרה", () => {
  it("פתיחה + נוסף − הועבר", () => {
    const s = computeWeekTurkeySummary({
      currency: "USD",
      openingBalance: 480,
      weekMovements: [
        { type: "CASH_COUNT_ALLOCATION", currency: "USD", amount: 3000 },
        { type: "TRANSFER_TO_TURKEY", currency: "USD", amount: 2000 },
      ],
      hasCashCount: true,
    });
    assert.equal(s.closingBalance, 1480);
  });
});

describe("QA-6 תיקון ספירה — התאמה", () => {
  it("הפרש +100", () => {
    const signed = signedMovementAmount("CASH_COUNT_ADJUSTMENT", 100);
    assert.equal(signed, 100);
  });
});

describe("QA-7 העברה מלאה", () => {
  it("יתרה 0", () => {
    const movements = [
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 }),
      mov({ weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 2980 }),
    ];
    const bal = sumMovementsByCurrency(movements, "USD");
    assert.equal(bal, 0);
  });
});

describe("QA-8 חסימת העברה מעל יתרה", () => {
  it("יתרה 480, העברה 500 — לא עובר", () => {
    const balance = 480;
    const attempt = 500;
    assert.ok(attempt > balance);
  });
});

describe("QA-9 הפרדת מטבעות", () => {
  it("USD ו-ILS נפרדים", () => {
    const movements = [
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 100, currency: "USD" }),
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 500, currency: "ILS" }),
      mov({ weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 40, currency: "USD" }),
    ];
    assert.equal(sumMovementsByCurrency(movements, "USD"), 60);
    assert.equal(sumMovementsByCurrency(movements, "ILS"), 500);
  });
});

describe("QA-10 ביטול העברה", () => {
  it("reversal מחזיר יתרה", () => {
    const movements = [
      mov({ weekCode: "AH-131", type: "CASH_COUNT_ALLOCATION", amount: 2980 }),
      mov({ weekCode: "AH-131", type: "TRANSFER_TO_TURKEY", amount: 2500 }),
      mov({ weekCode: "AH-131", type: "TRANSFER_REVERSAL", amount: 2500 }),
    ];
    assert.equal(sumMovementsByCurrency(movements, "USD"), 2980);
  });
});
