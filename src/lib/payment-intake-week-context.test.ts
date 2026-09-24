import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultOrderSourceDateYmdForIntakeWeek,
  orderSourceWeekCodeFromDateYmd,
  resolveOrderSourceWeekCode,
  resolvePaymentIntakeWeekContext,
  weekCodeForPaymentIntakeOrders,
} from "@/lib/payment-intake-week-context";
import { getAhWeekRange } from "@/lib/work-week";

describe("payment-intake-week-context", () => {
  it("AH-141 → מקור AH-141 (אותו שבוע)", () => {
    assert.equal(resolveOrderSourceWeekCode("AH-141"), "AH-141");
  });

  it("ניווט קליטה AH-139 → הזמנות AH-139", () => {
    assert.equal(resolveOrderSourceWeekCode("AH-139"), "AH-139");
    const ctx = resolvePaymentIntakeWeekContext("AH-139");
    assert.ok(ctx);
    assert.equal(ctx.intakeWeekCode, "AH-139");
    assert.equal(ctx.orderSourceWeekCode, "AH-139");
  });

  it("AH-135 → תאריך מקור = שבת AH-135", () => {
    const ctx = resolvePaymentIntakeWeekContext("AH-135");
    assert.ok(ctx);
    assert.equal(ctx.intakeWeekCode, "AH-135");
    assert.equal(ctx.orderSourceWeekCode, "AH-135");
    assert.equal(ctx.orderSourceDateYmd, getAhWeekRange("AH-135")?.to);
  });

  it("weekCodeForPaymentIntakeOrders — שבוע הקליטה", () => {
    assert.equal(weekCodeForPaymentIntakeOrders("AH-141"), "AH-141");
    assert.notEqual(weekCodeForPaymentIntakeOrders("AH-141"), "AH-142");
  });

  it("תאריך ידני 08/08/2026 → שבוע מקור AH-134", () => {
    const src = orderSourceWeekCodeFromDateYmd("2026-08-08");
    assert.equal(src, "AH-134");
    assert.equal(weekCodeForPaymentIntakeOrders("AH-135", "2026-08-08"), "AH-134");
  });

  it("defaultOrderSourceDateYmdForIntakeWeek = שבת אותו שבוע", () => {
    const d = defaultOrderSourceDateYmdForIntakeWeek("AH-135");
    assert.equal(d, getAhWeekRange("AH-135")?.to);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  });
});
