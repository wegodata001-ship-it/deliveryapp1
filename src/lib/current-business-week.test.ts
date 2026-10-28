import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getActiveWorkWeekRange, isActiveWorkWeekCode } from "@/lib/active-work-week";
import { resolveGlobalFilterWeekFromStorage } from "@/lib/global-filter-persist";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import { getCurrentAhWeek } from "@/lib/weeks/ah-week";
import {
  getCurrentBusinessWeek,
  prevWeekCode,
} from "@/lib/work-week";

describe("getCurrentBusinessWeek SSOT", () => {
  it("returns live AH week id + Sunday–Saturday range", () => {
    const frozen = new Date("2026-10-01T10:00:00+03:00");
    const live = getCurrentAhWeek(frozen);
    const current = getCurrentBusinessWeek(frozen);
    assert.equal(current.currentBusinessWeekId, live.code);
    assert.equal(current.startDate, live.from);
    assert.equal(current.endDate, live.to);
    assert.equal(current.currentBusinessWeekId, "AH-142");
  });

  it("fresh session default is current week, not a stored historical week", () => {
    const current = getCurrentBusinessWeek();
    const fresh = resolveGlobalFilterWeekFromStorage();
    const active = getActiveWorkWeekRange();
    assert.equal(fresh.weekCode, current.currentBusinessWeekId);
    assert.equal(fresh.weekCode, active.weekCode);
    assert.equal(fresh.fromYmd, current.startDate);
    assert.equal(fresh.toYmd, current.endDate);
    assert.notEqual(fresh.weekCode, "AH-137");
    assert.ok(isActiveWorkWeekCode(fresh.weekCode));
  });

  it("payment intake default is previous of the live current week", () => {
    const current = getCurrentBusinessWeek();
    assert.equal(defaultPaymentIntakeWeekCode(), prevWeekCode(current.currentBusinessWeekId));
    assert.notEqual(defaultPaymentIntakeWeekCode(), current.currentBusinessWeekId);
  });
});
