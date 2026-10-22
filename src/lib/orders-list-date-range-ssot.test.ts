import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrdersListWhereFromSearchParams } from "@/app/admin/orders/orders-list-where";
import { getAhWeekRange, isCustomOrdersDateRange, parseOrdersListDateFilterFromSearchParams } from "@/lib/work-week";

describe("orders list date-range SSOT", () => {
  it("July–October is a custom range, not AH-145", () => {
    assert.equal(isCustomOrdersDateRange("AH-145", "2026-07-01", "2026-10-22"), true);
    assert.equal(isCustomOrdersDateRange("", "2026-07-01", "2026-10-22"), true);
  });

  it("exact AH week dates stay in week mode", () => {
    const range = getAhWeekRange("AH-145");
    assert.ok(range);
    assert.equal(isCustomOrdersDateRange("AH-145", range.from, range.to), false);
    assert.equal(isCustomOrdersDateRange("", range.from, range.to), false);
  });

  it("TEST 1: parse keeps 2026-07-01..2026-10-22 and does not clamp to the current week", () => {
    const parsed = parseOrdersListDateFilterFromSearchParams({
      week: "AH-145",
      from: "2026-07-01",
      to: "2026-10-22",
      ordersFrom: "2026-07-01",
      ordersTo: "2026-10-22",
    });
    assert.equal(parsed.fromYmd, "2026-07-01");
    assert.equal(parsed.toYmd, "2026-10-22");
    assert.equal(parsed.ahWeekSelect, "");
  });

  it("TEST 6: explicit week parse uses the selected week range", () => {
    const week144 = getAhWeekRange("AH-144");
    const week145 = getAhWeekRange("AH-145");
    assert.ok(week144 && week145);
    const parsed144 = parseOrdersListDateFilterFromSearchParams({
      ordersWeek: "AH-144",
      ordersFrom: week144.from,
      ordersTo: week144.to,
    });
    assert.equal(parsed144.ahWeekSelect, "AH-144");
    assert.equal(parsed144.fromYmd, week144.from);
    const parsed145 = parseOrdersListDateFilterFromSearchParams({
      ordersWeek: "AH-145",
      ordersFrom: week145.from,
      ordersTo: week145.to,
    });
    assert.equal(parsed145.ahWeekSelect, "AH-145");
    assert.equal(parsed145.fromYmd, week145.from);
  });

  it("date-range where uses orderDate, leftover weekCode does not win", () => {
    const where = buildOrdersListWhereFromSearchParams({
      ordersWeek: "AH-145",
      ordersFrom: "2026-07-01",
      ordersTo: "2026-10-22",
      from: "2026-07-01",
      to: "2026-10-22",
    });
    assert.equal("weekCode" in where, false);
    assert.ok(where.orderDate);
  });

  it("week mode where uses weekCode", () => {
    const range = getAhWeekRange("AH-145");
    assert.ok(range);
    const where = buildOrdersListWhereFromSearchParams({
      ordersWeek: "AH-145",
      ordersFrom: range.from,
      ordersTo: range.to,
    });
    assert.equal(where.weekCode, "AH-145");
  });
});
