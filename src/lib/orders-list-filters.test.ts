import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrdersListSearchParams,
  countAdvancedFilters,
  parseOrderFiltersFromSearchParams,
  type OrderFilters,
} from "@/lib/orders-list-filters";
import { getAhWeekRange } from "@/lib/work-week";

function emptyFilters(overrides: Partial<OrderFilters> = {}): OrderFilters {
  return {
    week: "AH-1",
    dateFrom: "2026-08-30",
    dateTo: "2026-09-05",
    search: "",
    country: [],
    paymentMethod: [],
    paymentStatus: [],
    status: [],
    orderNumber: "",
    phone: "",
    paymentLocation: "",
    createdBy: [],
    minAmountUsd: "",
    maxAmountUsd: "",
    openOnly: false,
    completedOnly: false,
    ordersCompleted: "all",
    kpiStatuses: [],
    ...overrides,
  };
}

describe("countAdvancedFilters", () => {
  it("counts only applied advanced fields", () => {
    assert.equal(countAdvancedFilters(emptyFilters(), false), 0);
    assert.equal(
      countAdvancedFilters(
        emptyFilters({
          phone: "050",
          orderNumber: "12",
          country: ["IL"],
        }),
        true,
      ),
      4,
    );
  });
});

describe("orders week URL SSOT", () => {
  it("writes ordersWeek as the list week and derives dates from AH mapping", () => {
    const range = getAhWeekRange("AH-139");
    assert.ok(range);
    const params = buildOrdersListSearchParams(
      emptyFilters({ week: "AH-139", dateFrom: range.from, dateTo: range.to }),
      new URLSearchParams("week=AH-138&from=2026-08-16&to=2026-08-22&country=TURKEY"),
    );
    assert.equal(params.get("ordersWeek"), "AH-139");
    assert.equal(params.get("ordersFrom"), range.from);
    assert.equal(params.get("ordersTo"), range.to);
    assert.equal(params.get("week"), "AH-139");
    assert.equal(params.get("country"), "TURKEY");
  });

  it("parses ordersWeek as the list week even if week= differs", () => {
    const range = getAhWeekRange("AH-139");
    assert.ok(range);
    const parsed = parseOrderFiltersFromSearchParams(
      {
        ordersWeek: "AH-139",
        ordersFrom: range.from,
        ordersTo: range.to,
        week: "AH-138",
      },
      { week: "AH-138", dateFrom: "2026-08-16", dateTo: "2026-08-22" },
    );
    assert.equal(parsed.week, "AH-139");
    assert.equal(parsed.dateFrom, range.from);
    assert.equal(parsed.dateTo, range.to);
  });

  it("TEST 1/2: custom date range writes from/to and does not keep ordersWeek", () => {
    const params = buildOrdersListSearchParams(
      emptyFilters({
        week: "",
        dateFrom: "2026-07-01",
        dateTo: "2026-10-22",
        paymentMethod: ["CASH"],
      }),
      new URLSearchParams("ordersWeek=AH-145&week=AH-145&from=2026-10-18&to=2026-10-24&country=TURKEY"),
    );
    assert.equal(params.get("ordersWeek"), null);
    assert.equal(params.get("ordersPreset"), "range");
    assert.equal(params.get("from"), "2026-07-01");
    assert.equal(params.get("to"), "2026-10-22");
    assert.equal(params.get("ordersFrom"), "2026-07-01");
    assert.equal(params.get("ordersTo"), "2026-10-22");
    assert.equal(params.get("paymentType"), "CASH");
    assert.equal(params.get("country"), "TURKEY");
  });

  it("TEST 2: refresh parse keeps custom dates and does not default the week", () => {
    const parsed = parseOrderFiltersFromSearchParams(
      {
        from: "2026-07-01",
        to: "2026-10-22",
        ordersFrom: "2026-07-01",
        ordersTo: "2026-10-22",
        week: "AH-145",
      },
      { week: "AH-145", dateFrom: "2026-10-18", dateTo: "2026-10-24" },
    );
    assert.equal(parsed.week, "");
    assert.equal(parsed.dateFrom, "2026-07-01");
    assert.equal(parsed.dateTo, "2026-10-22");
  });

  it("preserves multi KPI selection when rebuilding URL for a new week", () => {
    const range = getAhWeekRange("AH-134");
    assert.ok(range);
    const params = buildOrdersListSearchParams(
      emptyFilters({
        week: "AH-134",
        dateFrom: range.from,
        dateTo: range.to,
        kpiStatuses: ["completed", "operationalCompleted"],
        paymentMethod: ["CASH"],
      }),
      new URLSearchParams("ordersWeek=AH-133&ordersKpi=completed,operationalCompleted&paymentType=CASH"),
    );
    assert.equal(params.get("ordersWeek"), "AH-134");
    assert.equal(params.get("ordersKpi"), "completed,operationalCompleted");
    assert.equal(params.get("paymentType"), "CASH");
  });
});
