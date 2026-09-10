import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatYmdJerusalem } from "@/lib/weeks/ah-week";
import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import { resolveCashExpenseBusinessPeriod } from "@/lib/cash-expense-period";

describe("resolveCashExpenseBusinessPeriod", () => {
  it("defaults empty date to Jerusalem today, not payment-intake Saturday", () => {
    const now = new Date("2026-09-10T08:15:00+03:00");
    const period = resolveCashExpenseBusinessPeriod({ now });
    assert.equal(period.dateYmd, "2026-09-10");
    assert.equal(period.weekCode, "AH-139");
    const intake = resolvePaymentIntakeAccountingPeriod("AH-139");
    assert.equal(intake?.businessDate, "2026-09-05");
    assert.notEqual(period.dateYmd, intake?.businessDate);
  });

  it("derives week from expenseDate even if a selected week would differ", () => {
    const period = resolveCashExpenseBusinessPeriod({
      dateYmd: "2026-09-10",
      timeHm: "14:30",
    });
    assert.equal(period.dateYmd, "2026-09-10");
    assert.equal(period.weekCode, "AH-139");
    assert.equal(formatYmdJerusalem(period.expenseDate), "2026-09-10");
  });

  it("manual date 09/09 stays on 09/09 and takes that AH week", () => {
    const period = resolveCashExpenseBusinessPeriod({
      dateYmd: "2026-09-09",
      timeHm: "09:00",
    });
    assert.equal(period.dateYmd, "2026-09-09");
    assert.equal(period.weekCode, "AH-139");
    assert.equal(formatYmdJerusalem(period.expenseDate), "2026-09-09");
  });

  it("late Jerusalem evening stays on the same calendar day", () => {
    const period = resolveCashExpenseBusinessPeriod({
      dateYmd: "2026-09-10",
      timeHm: "23:40",
    });
    assert.equal(period.dateYmd, "2026-09-10");
    assert.equal(formatYmdJerusalem(period.expenseDate), "2026-09-10");
  });
});
