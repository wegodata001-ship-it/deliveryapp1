import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultPaymentIntakeDateYmd,
  defaultPaymentIntakeWeekCode,
} from "@/lib/payment-intake-default-week";
import { resolveOrderSourceWeekCode } from "@/lib/payment-intake-week-context";
import { getAhWeekRange, getBusinessWeekClosingDate } from "@/lib/work-week";

describe("defaultPaymentIntakeWeekCode", () => {
  it("בית AH-141 → קליטה AH-141 → הזמנות AH-141", () => {
    const payment = defaultPaymentIntakeWeekCode("AH-141");
    assert.equal(payment, "AH-141");
    assert.equal(resolveOrderSourceWeekCode(payment), "AH-141");
  });

  it("בית AH-136 → קליטה AH-136 (לא +1)", () => {
    const payment = defaultPaymentIntakeWeekCode("AH-136");
    assert.equal(payment, "AH-136");
    assert.equal(resolveOrderSourceWeekCode(payment), "AH-136");
    assert.notEqual(payment, "AH-137");
  });

  it("בית AH-137 → קליטה AH-137", () => {
    assert.equal(defaultPaymentIntakeWeekCode("AH-137"), "AH-137");
  });

  it("נורמליזציה של קלט", () => {
    assert.equal(defaultPaymentIntakeWeekCode(" ah-141 "), "AH-141");
  });
});

describe("defaultPaymentIntakeDateYmd — Saturday of previous (financial) week", () => {
  it("AH-135 → financial AH-134 → 2026-08-08", () => {
    assert.equal(getAhWeekRange("AH-134")?.to, "2026-08-08");
    assert.equal(getBusinessWeekClosingDate("AH-134"), "2026-08-08");
    assert.equal(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-08");
    assert.notEqual(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-15");
  });

  it("שינוי שבוע קליטה מעדכן לשבת השבוע הקודם", () => {
    assert.equal(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-08");
    assert.equal(defaultPaymentIntakeDateYmd("AH-136"), "2026-08-15");
    assert.equal(defaultPaymentIntakeDateYmd("AH-137"), "2026-08-22");
    assert.equal(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-08");
  });

  it("תאריך היום לא משפיע על תאריך הביצוע של AH-135", () => {
    const RealDate = Date;
    const frozen = new RealDate("2026-09-06T14:52:00+03:00");
    class FakeDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) super(frozen.getTime());
        else super(...args);
      }
      static now() {
        return frozen.getTime();
      }
    }
    const prev = globalThis.Date;
    globalThis.Date = FakeDate as unknown as DateConstructor;
    try {
      assert.equal(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-08");
      assert.notEqual(defaultPaymentIntakeDateYmd("AH-135"), "2026-09-06");
      assert.notEqual(defaultPaymentIntakeDateYmd("AH-135"), "2026-08-15");
    } finally {
      globalThis.Date = prev;
    }
  });
});
