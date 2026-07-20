import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentDayKeyJerusalem } from "@/lib/cash-control-daily";
import { cashControlWeekMembershipWhere } from "@/lib/cash-control-week-payments";
import { getAhWeekRange } from "@/lib/weeks/ah-week";
import { parseLocalDate } from "@/lib/work-week";

describe("paymentDayKeyJerusalem — intakeDate", () => {
  it("prefers intakeDate over paymentDate", () => {
    const key = paymentDayKeyJerusalem({
      intakeDate: parseLocalDate("2026-07-30"),
      paymentDate: parseLocalDate("2026-07-19"),
      createdAt: parseLocalDate("2026-07-20"),
    });
    assert.equal(key, "2026-07-30");
  });

  it("falls back to paymentDate when intakeDate is null", () => {
    const key = paymentDayKeyJerusalem({
      intakeDate: null,
      paymentDate: parseLocalDate("2026-07-19"),
      createdAt: parseLocalDate("2026-07-20"),
    });
    assert.equal(key, "2026-07-19");
  });
});

describe("cashControlWeekMembershipWhere", () => {
  it("includes intakeDate range for the AH week", () => {
    const range = getAhWeekRange("AH-132");
    assert.ok(range);
    const where = cashControlWeekMembershipWhere("AH-132");
    const or = (where as { OR: unknown[] }).OR;
    assert.ok(Array.isArray(or) && or.length === 2);
    const byIntake = or[0] as { intakeDate: { gte: Date; lt: Date } };
    assert.ok(byIntake.intakeDate.gte);
    assert.ok(byIntake.intakeDate.lt);
  });
});
