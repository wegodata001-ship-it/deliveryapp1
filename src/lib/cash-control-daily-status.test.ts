import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDailyStatus,
  emptyDailyExpenses,
  emptyDailyIntake,
  type CashDailyDrawerValues,
  type CashDailyIntakeTotals,
} from "@/lib/cash-control-daily";

function intake(partial: Partial<CashDailyIntakeTotals>): CashDailyIntakeTotals {
  return { ...emptyDailyIntake(), ...partial };
}

describe("computeDailyStatus — סטטוס יומי בבקרת קופה", () => {
  it("ממתין — אין שום פעילות", () => {
    const r = computeDailyStatus(emptyDailyIntake(), {}, emptyDailyExpenses());
    assert.equal(r.kind, "pending");
  });

  it("לא מאוזן — יש קליטה אך אין ספירה", () => {
    const r = computeDailyStatus(intake({ CASH_ILS: 100 }), {}, emptyDailyExpenses());
    assert.equal(r.kind, "warn");
  });

  it("לא מאוזן — יש הוצאה אך אין ספירה", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 50;
    const r = computeDailyStatus(emptyDailyIntake(), {}, expenses);
    assert.equal(r.kind, "warn");
  });

  it("מאוזן — ספירה תואמת לקליטה", () => {
    const drawer: CashDailyDrawerValues = { CASH_ILS: 100 };
    const r = computeDailyStatus(intake({ CASH_ILS: 100 }), drawer, emptyDailyExpenses());
    assert.equal(r.kind, "ok");
  });

  it("לא מאוזן — ספירה עם הפרש", () => {
    const drawer: CashDailyDrawerValues = { CASH_ILS: 80 };
    const r = computeDailyStatus(intake({ CASH_ILS: 100 }), drawer, emptyDailyExpenses());
    assert.ok(r.kind === "warn" || r.kind === "critical");
  });

  it("לא מאוזן — יש קליטה בערוץ שלא נספר", () => {
    const drawer: CashDailyDrawerValues = { CASH_ILS: 100 };
    const r = computeDailyStatus(
      intake({ CASH_ILS: 100, BANK_TRANSFER_ILS: 50 }),
      drawer,
      emptyDailyExpenses(),
    );
    assert.equal(r.kind, "warn");
  });
});
