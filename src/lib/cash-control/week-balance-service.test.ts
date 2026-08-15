import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDailyExpenses } from "@/lib/cash-control-daily";
import {
  buildWeekBalanceAggregates,
  computeWeekBalanceSnapshot,
  deriveWeekBalanceStatus,
} from "@/lib/cash-control/week-balance-calculation";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

describe("computeWeekBalanceSnapshot — איזון שבוע", () => {
  it("אין פעילות — שבוע פתוח ללא איזון", () => {
    const snapshot = computeWeekBalanceSnapshot(buildWeekBalanceAggregates({}));
    assert.ok(snapshot);
    assert.equal(snapshot!.hasWeekActivity, false);
    assert.equal(snapshot!.hasPendingCounts, false);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "OPEN");
  });

  it("₪0 הכנסות / ₪100 הוצאות ללא ספירה — לא מאוזן (NEEDS_BALANCE)", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 100;
    const snapshot = computeWeekBalanceSnapshot(buildWeekBalanceAggregates({ expenses }));
    assert.ok(snapshot);
    assert.equal(snapshot!.ils.expenses, 100);
    assert.equal(snapshot!.ils.income, 0);
    assert.equal(snapshot!.hasWeekActivity, true);
    assert.equal(snapshot!.hasPendingCounts, true);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "NEEDS_BALANCE");
  });

  it("₪100 הכנסה / ₪0 הוצאות / ללא ספירה — לא מאוזן", () => {
    const snapshot = computeWeekBalanceSnapshot(
      buildWeekBalanceAggregates({ intake: { CASH_ILS: 100 } }),
    );
    assert.ok(snapshot);
    assert.equal(snapshot!.hasPendingCounts, true);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "NEEDS_BALANCE");
  });

  it("₪100 הכנסה / ₪100 הוצאות / ספירה 0 — הפרש 0 → READY (לא BALANCED)", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 100;
    const snapshot = computeWeekBalanceSnapshot(
      buildWeekBalanceAggregates({
        intake: { CASH_ILS: 100 },
        drawer: { CASH_ILS: 0 },
        expenses,
      }),
    );
    assert.ok(snapshot);
    assert.equal(snapshot!.hasPendingCounts, false);
    assert.equal(snapshot!.ils.expected, 0);
    assert.equal(snapshot!.ils.counted, 0);
    assert.ok(Math.abs(snapshot!.ils.diff) <= CASH_CONTROL_EPS);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "READY");
  });

  it("חוסר ₪100 — ספירה נמוכה מהצפוי", () => {
    const snapshot = computeWeekBalanceSnapshot(
      buildWeekBalanceAggregates({
        intake: { CASH_ILS: 100 },
        drawer: { CASH_ILS: 0 },
      }),
    );
    assert.ok(snapshot);
    assert.equal(snapshot!.ils.diff, -100);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "NEEDS_BALANCE");
  });

  it("עודף ₪100 — ספירה גבוהה מהצפוי", () => {
    const snapshot = computeWeekBalanceSnapshot(
      buildWeekBalanceAggregates({
        intake: { CASH_ILS: 100 },
        drawer: { CASH_ILS: 200 },
      }),
    );
    assert.ok(snapshot);
    assert.equal(snapshot!.ils.diff, 100);
    assert.equal(deriveWeekBalanceStatus(snapshot!, null, null), "NEEDS_BALANCE");
  });

  it("מטבעות נפרדים — ₪100 הוצאה לא משפיעה על USD", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 100;
    const snapshot = computeWeekBalanceSnapshot(buildWeekBalanceAggregates({ expenses }));
    assert.ok(snapshot);
    assert.equal(snapshot!.ils.expenses, 100);
    assert.equal(snapshot!.usd.expenses, 0);
    assert.equal(snapshot!.usd.income, 0);
  });

  it("BALANCED נשמר רק כש-hash תואם", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 100;
    const snapshot = computeWeekBalanceSnapshot(buildWeekBalanceAggregates({ expenses }));
    assert.ok(snapshot);
    assert.equal(
      deriveWeekBalanceStatus(snapshot!, "BALANCED", snapshot!.dataHash),
      "BALANCED",
    );
    assert.equal(deriveWeekBalanceStatus(snapshot!, "BALANCED", "stale-hash"), "NEEDS_BALANCE");
  });

  it("regression AH-135 — הוצאה ₪100 ללא הכנסה לא יכולה להיות READY", () => {
    const expenses = emptyDailyExpenses();
    expenses.CASH_ILS = 100;
    const snapshot = computeWeekBalanceSnapshot(
      buildWeekBalanceAggregates({ weekCode: "AH-135", expenses }),
    );
    assert.ok(snapshot);
    const status = deriveWeekBalanceStatus(snapshot!, null, null);
    assert.notEqual(status, "READY");
    assert.notEqual(status, "BALANCED");
    assert.equal(status, "NEEDS_BALANCE");
  });
});
