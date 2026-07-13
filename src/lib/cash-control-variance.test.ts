/**
 * QA — חישוב הפרש בקרת קופה עם קיזוז הוצאות לפי ערוץ.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateCashControlVariance } from "@/lib/cash-control-calculation";
import { buildDailyReconciliation, emptyDailyExpenses, emptyDailyIntake } from "@/lib/cash-control-daily";
import { addExpenseToMethodTotals } from "@/lib/cash-expense-payment-method";
import { previewExpenseVarianceImpact, computeCashVarianceDay } from "@/lib/cash-control-variance";

describe("QA-1 מזומן דולר", () => {
  it("הפרש 0 תקין", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 100,
      countedAmount: 1900,
    });
    assert.equal(r.expectedNetAmount, 1900);
    assert.equal(r.varianceAmount, 0);
    assert.equal(r.status, "MATCHED");
  });
});

describe("QA-2 מזומן שקל", () => {
  it("תקין", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 5000,
      existingExpensesAmount: 200,
      countedAmount: 4800,
    });
    assert.equal(r.status, "MATCHED");
  });
});

describe("QA-3 העברה דולר", () => {
  it("תקין", () => {
    const intake = { ...emptyDailyIntake(), BANK_TRANSFER_USD: 2000 };
    const expenses = addExpenseToMethodTotals(emptyDailyExpenses(), "BANK_TRANSFER", "USD", 1);
    const line = buildDailyReconciliation(intake, { BANK_TRANSFER_USD: 1999 }, expenses).find(
      (l) => l.method === "BANK_TRANSFER_USD",
    )!;
    assert.equal(line.diff, 0);
    assert.equal(line.status, "ok");
  });
});

describe("QA-4 אשראי שקל", () => {
  it("תקין", () => {
    const intake = { ...emptyDailyIntake(), CREDIT_CARD_ILS: 2080 };
    const expenses = addExpenseToMethodTotals(emptyDailyExpenses(), "CREDIT_CARD", "ILS", 80);
    const line = buildDailyReconciliation(intake, { CREDIT_CARD_ILS: 2000 }, expenses).find(
      (l) => l.method === "CREDIT_CARD_ILS",
    )!;
    assert.equal(line.diff, 0);
  });
});

describe("QA-5 צ׳ק שקל", () => {
  it("תקין", () => {
    const intake = { ...emptyDailyIntake(), CHECK_ILS: 1999 };
    const expenses = addExpenseToMethodTotals(emptyDailyExpenses(), "CHECK", "ILS", 100);
    const line = buildDailyReconciliation(intake, { CHECK_ILS: 1899 }, expenses).find(
      (l) => l.method === "CHECK_ILS",
    )!;
    assert.equal(line.diff, 0);
  });
});

describe("QA-6 ערוץ לא תואם", () => {
  it("הוצאה במזומן לא סוגרת חריגה בהעברה", () => {
    const intake = { ...emptyDailyIntake(), BANK_TRANSFER_USD: 2000 };
    const expenses = addExpenseToMethodTotals(emptyDailyExpenses(), "CASH", "USD", 100);
    const bank = buildDailyReconciliation(intake, { BANK_TRANSFER_USD: 1900 }, expenses).find(
      (l) => l.method === "BANK_TRANSFER_USD",
    )!;
    assert.equal(bank.diff, -100);
    assert.equal(bank.expense, 0);
  });
});

describe("QA-7 כמה הוצאות", () => {
  it("סה״כ 100 תקין", () => {
    let expenses = addExpenseToMethodTotals(emptyDailyExpenses(), "CASH", "USD", 60);
    expenses = addExpenseToMethodTotals(expenses, "CASH", "USD", 40);
    const line = buildDailyReconciliation(
      { ...emptyDailyIntake(), CASH_USD: 2000 },
      { CASH_USD: 1900 },
      expenses,
    ).find((l) => l.method === "CASH_USD")!;
    assert.equal(line.expense, 100);
    assert.equal(line.diff, 0);
  });
});

describe("QA-8 ללא ספירה", () => {
  it("ממתין לספירה", () => {
    const r = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 100,
      countedAmount: null,
    });
    assert.equal(r.status, "WAITING_FOR_COUNT");
    assert.equal(r.varianceAmount, null);
  });
});

describe("QA-9 עריכת הוצאה", () => {
  it("צפוי נטו מתעדכן", () => {
    const before = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 100,
      countedAmount: 1900,
    });
    const after = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 80,
      countedAmount: 1900,
    });
    assert.equal(before.expectedNetAmount, 1900);
    assert.equal(after.expectedNetAmount, 1920);
    assert.equal(after.varianceAmount, -20);
  });
});

describe("QA-10 מחיקת הוצאה", () => {
  it("החריגה חוזרת", () => {
    const withExp = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 100,
      countedAmount: 1900,
    });
    const without = calculateCashControlVariance({
      receivedAmount: 2000,
      existingExpensesAmount: 0,
      countedAmount: 1900,
    });
    assert.equal(withExp.status, "MATCHED");
    assert.equal(without.status, "SHORTAGE");
    assert.equal(without.varianceAmount, -100);
  });
});

describe("תצוגת השפעה — סוגר חריגה", () => {
  it("preview closes", () => {
    const intake = { ...emptyDailyIntake(), BANK_TRANSFER_USD: 2000 };
    const drawer = { BANK_TRANSFER_USD: 1999 };
    const day = computeCashVarianceDay(intake, drawer, emptyDailyExpenses());
    const preview = previewExpenseVarianceImpact(day.lines, "USD", 1, "BANK_TRANSFER_USD");
    assert.equal(preview.messageKind, "closes");
  });
});
