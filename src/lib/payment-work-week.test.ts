import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import {
  PAYMENT_WORK_WEEK_REQUIRED_ERROR,
  resolveSubmittedPaymentWorkWeek,
} from "@/lib/payment-work-week";
import { getWeekCodeForLocalDate, parseLocalDate } from "@/lib/work-week";

describe("payment work week — selected week is SSOT", () => {
  it("AH-141 selected → stored AH-141 even when paymentDate is 26/09", () => {
    const uiWeek = "AH-141";
    const submitted = resolveSubmittedPaymentWorkWeek(uiWeek);
    const dateWeek = getWeekCodeForLocalDate(parseLocalDate("2026-09-26"));
    assert.equal(defaultPaymentIntakeWeekCode("AH-142"), "AH-141");
    assert.equal(submitted, "AH-141");
    assert.equal(dateWeek, "AH-141");
    assert.notEqual(submitted, "AH-142");
  });

  it("26/09 is AH-141, not AH-142 — date must not assign next week", () => {
    assert.equal(getWeekCodeForLocalDate(parseLocalDate("2026-09-24")), "AH-141");
    assert.equal(getWeekCodeForLocalDate(parseLocalDate("2026-09-26")), "AH-141");
    assert.equal(getWeekCodeForLocalDate(parseLocalDate("2026-09-27")), "AH-142");
  });

  it("manual AH-142 is stored only when the selector sends AH-142", () => {
    assert.equal(resolveSubmittedPaymentWorkWeek("AH-142"), "AH-142");
    assert.equal(resolveSubmittedPaymentWorkWeek("AH-141"), "AH-141");
  });

  it("missing / invalid week is rejected — no paymentDate fallback", () => {
    assert.equal(resolveSubmittedPaymentWorkWeek(null), null);
    assert.equal(resolveSubmittedPaymentWorkWeek(""), null);
    assert.equal(resolveSubmittedPaymentWorkWeek("not-a-week"), null);
    assert.equal(PAYMENT_WORK_WEEK_REQUIRED_ERROR, "חסר שבוע קליטה");
  });
});
