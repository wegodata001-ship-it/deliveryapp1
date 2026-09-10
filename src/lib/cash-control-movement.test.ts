/**
 * SSOT — הוצאת קופה לפי סכום חתום + רגרסיית 12/09/2026.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateCashControlVariance } from "@/lib/cash-control-calculation";
import {
  buildDailyReconciliation,
  emptyDailyExpenses,
  emptyDailyIntake,
} from "@/lib/cash-control-daily";
import { addExpenseToMethodTotals, aggregateExpensesByMethod } from "@/lib/cash-expense-payment-method";
import { computeWeeklyCashBalance } from "@/lib/cash-control/week-balance-calculation";
import {
  cashControlStatusLabel,
  computeCashVarianceDay,
  formatVarianceShort,
  previewExpenseVarianceImpact,
} from "@/lib/cash-control-variance";
import { resolveCashExpenseBusinessPeriod } from "@/lib/cash-expense-period";
import {
  CASH_EXPENSE_AMOUNT_ERROR,
  cashMovementExpenseTerm,
  cashMovementNetEffect,
  normalizeCashControlMovement,
  resolveCreateCashMovement,
  resolveUpdateDirectedCashMovement,
} from "@/lib/cash-control-movement";

const HISTORICAL_1209_ILS = [
  { amount: 400 },
  { amount: 50 },
  { amount: -200 },
  { amount: 200 },
  { amount: 550 },
];

describe("normalizeCashControlMovement — signed amount", () => {
  it("100 → netEffect -100, expenseTerm 100", () => {
    const n = normalizeCashControlMovement({ amount: 100 });
    assert.equal(n.amount, 100);
    assert.equal(n.netEffect, -100);
    assert.equal(n.expenseTerm, 100);
  });

  it("-100 → netEffect +100, expenseTerm -100", () => {
    const n = normalizeCashControlMovement({ amount: -100 });
    assert.equal(n.amount, -100);
    assert.equal(n.netEffect, 100);
    assert.equal(n.expenseTerm, -100);
  });

  it("direction לא משנה את החישוב", () => {
    const a = normalizeCashControlMovement({ amount: 100, direction: "INCOME" });
    const b = normalizeCashControlMovement({ amount: 100, direction: "EXPENSE" });
    const c = normalizeCashControlMovement({ amount: 100, direction: null });
    assert.equal(a.expenseTerm, 100);
    assert.equal(b.expenseTerm, 100);
    assert.equal(c.expenseTerm, 100);
    assert.equal(a.netEffect, -100);
  });

  it("אין Math.abs — סימן נשמר", () => {
    const n = normalizeCashControlMovement({ amount: -200, direction: "EXPENSE" });
    assert.equal(n.amount, -200);
    assert.equal(n.expenseTerm, -200);
    assert.equal(n.netEffect, 200);
  });
});

describe("TEST A — received 1000, expense 100 → expected 900", () => {
  it("PASS", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 1000,
      existingExpensesAmount: cashMovementExpenseTerm([{ amount: 100 }]),
      countedAmount: null,
    });
    assert.equal(r.totalExpensesAmount, 100);
    assert.equal(r.expectedNetAmount, 900);
  });
});

describe("TEST B — received 1000, expense -100 → expected 1100", () => {
  it("PASS", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 1000,
      existingExpensesAmount: cashMovementExpenseTerm([{ amount: -100 }]),
      countedAmount: null,
    });
    assert.equal(r.totalExpensesAmount, -100);
    assert.equal(r.expectedNetAmount, 1100);
  });
});

describe("TEST C — 100 + (-100) → net 0, expected unchanged", () => {
  it("PASS", () => {
    const term = cashMovementExpenseTerm([{ amount: 100 }, { amount: -100 }]);
    assert.equal(term, 0);
    const r = calculateCashControlVariance({
      receivedAmount: 1000,
      existingExpensesAmount: term,
      countedAmount: null,
    });
    assert.equal(r.expectedNetAmount, 1000);
  });
});

describe("TEST D — 12/09/2026 CASH ILS", () => {
  it("Expenses total 1000 · Expected 6000 · Actual 6000 · Diff 0", () => {
    const expenseTerm = cashMovementExpenseTerm(HISTORICAL_1209_ILS);
    assert.equal(expenseTerm, 1000);
    assert.equal(cashMovementNetEffect(HISTORICAL_1209_ILS), -1000);

    const r = calculateCashControlVariance({
      receivedAmount: 7000,
      existingExpensesAmount: expenseTerm,
      countedAmount: 6000,
    });
    assert.equal(r.expectedNetAmount, 6000);
    assert.equal(r.varianceAmount, 0);
    assert.equal(r.status, "MATCHED");
    assert.equal(cashControlStatusLabel(r.status), "תקין");
  });

  it("Daily reconciliation", () => {
    const expenses = aggregateExpensesByMethod(
      HISTORICAL_1209_ILS.map((e) => ({
        paymentMethod: "CASH",
        currency: "ILS",
        amount: e.amount,
      })),
    );
    const line = buildDailyReconciliation(
      { ...emptyDailyIntake(), CASH_ILS: 7000 },
      { CASH_ILS: 6000 },
      expenses,
    ).find((l) => l.method === "CASH_ILS")!;
    assert.equal(line.expense, 1000);
    assert.equal(line.received, 6000);
    assert.equal(line.diff, 0);
    assert.equal(line.status, "ok");
  });

  it("Weekly reconciliation", () => {
    const expenses = aggregateExpensesByMethod(
      HISTORICAL_1209_ILS.map((e) => ({
        paymentMethod: "CASH",
        currency: "ILS",
        amount: e.amount,
      })),
    );
    const snap = computeWeeklyCashBalance({
      weekCode: "AH-139",
      weekIntake: { ...emptyDailyIntake(), CASH_ILS: 7000 },
      weekDrawer: { CASH_ILS: 6000 },
      weekExpenses: expenses,
    });
    assert.ok(snap);
    assert.equal(snap.ils.expected, 6000);
    assert.equal(snap.ils.counted, 6000);
    assert.equal(snap.ils.diff, 0);
  });
});

describe("TEST E — received 400, expense -200 → expected 600, counted 0 → חוסר 600", () => {
  it("PASS", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 400,
      existingExpensesAmount: cashMovementExpenseTerm([{ amount: -200 }]),
      countedAmount: 0,
    });
    assert.equal(r.expectedNetAmount, 600);
    assert.equal(r.varianceAmount, -600);
    assert.equal(r.status, "SHORTAGE");
    assert.equal(cashControlStatusLabel(r.status), "חסר");
    assert.match(formatVarianceShort("ILS", r.varianceAmount), /₪600/);
  });
});

describe("persist — שמירת סימן", () => {
  it("שומר -100 כמו שהוא, direction=null", () => {
    const saved = resolveCreateCashMovement({ amount: -100 });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.amount, -100);
    assert.equal(saved.direction, null);
    assert.equal(normalizeCashControlMovement(saved).netEffect, 100);
  });

  it("שומר 100 כמו שהוא", () => {
    const saved = resolveCreateCashMovement({ amount: 100, direction: "EXPENSE" });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.amount, 100);
    assert.equal(saved.direction, null);
    assert.equal(normalizeCashControlMovement(saved).netEffect, -100);
  });

  it("עריכה 100 → -100 על אותה רשומה", () => {
    const created = resolveCreateCashMovement({ amount: 100 });
    assert.ok(created.ok);
    if (!created.ok) return;
    const edited = resolveUpdateDirectedCashMovement({ amount: -100 });
    assert.ok(edited.ok);
    if (!edited.ok) return;
    assert.equal(edited.amount, -100);
    assert.equal(normalizeCashControlMovement(edited).netEffect, 100);
  });

  it("חוסם 0 / ריק / לא מספרי", () => {
    assert.equal(resolveCreateCashMovement({ amount: 0 }).ok, false);
    assert.equal(resolveCreateCashMovement({ amount: "" }).ok, false);
    assert.equal(resolveCreateCashMovement({ amount: "abc" }).ok, false);
    const zero = resolveCreateCashMovement({ amount: 0 });
    if (!zero.ok) assert.equal(zero.error, CASH_EXPENSE_AMOUNT_ERROR);
  });
});

describe("USD — אותו כלל, בלי המרה", () => {
  it("$100 מוריד, -$100 מוסיף", () => {
    const down = calculateCashControlVariance({
      receivedAmount: 1000,
      existingExpensesAmount: cashMovementExpenseTerm([{ amount: 100 }]),
      countedAmount: null,
    });
    assert.equal(down.expectedNetAmount, 900);
    const up = calculateCashControlVariance({
      receivedAmount: 1000,
      existingExpensesAmount: cashMovementExpenseTerm([{ amount: -100 }]),
      countedAmount: null,
    });
    assert.equal(up.expectedNetAmount, 1100);
  });
});

describe("preview — סכום חתום", () => {
  it("100 מגדיל הוצאות ומוריד צפוי", () => {
    const day = computeCashVarianceDay(
      { ...emptyDailyIntake(), CASH_ILS: 1000 },
      { CASH_ILS: 1000 },
      emptyDailyExpenses(),
    );
    const preview = previewExpenseVarianceImpact(day.lines, "ILS", 100, "CASH_ILS");
    assert.equal(preview.afterExpensesAmount, 100);
    assert.equal(preview.afterExpectedNet, 900);
  });

  it("-100 מקטין הוצאות ומעלה צפוי", () => {
    const existing = addExpenseToMethodTotals(emptyDailyExpenses(), "CASH", "ILS", 100);
    const day = computeCashVarianceDay(
      { ...emptyDailyIntake(), CASH_ILS: 1000 },
      { CASH_ILS: 1000 },
      existing,
    );
    const preview = previewExpenseVarianceImpact(day.lines, "ILS", -100, "CASH_ILS");
    assert.equal(preview.afterExpensesAmount, 0);
    assert.equal(preview.afterExpectedNet, 1000);
  });
});

describe("תאריך ברירת מחדל — היום בירושלים", () => {
  it("בלי תאריך → היום", () => {
    const now = new Date("2026-09-10T12:00:00+03:00");
    const p = resolveCashExpenseBusinessPeriod({ now });
    assert.equal(p.dateYmd, "2026-09-10");
  });

  it("תאריך ידני נשמר והשבוע נגזר ממנו", () => {
    const p = resolveCashExpenseBusinessPeriod({ dateYmd: "2026-09-05", timeHm: "10:00" });
    assert.equal(p.dateYmd, "2026-09-05");
    assert.ok(p.weekCode);
  });
});
