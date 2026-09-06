import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OS } from "@/lib/order-status-slugs";
import {
  ORDERS_KPI_PARAM,
  orderMatchesOrdersKpiFilters,
  parseOrdersKpiFilters,
  serializeOrdersKpiFilters,
  toggleOrdersKpiFilter,
} from "@/lib/orders-status-kpi-filter";

describe("orders KPI multi-select", () => {
  it("בוצע matches COMPLETED only — not isCompleted", () => {
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: false }, ["completed"]),
      true,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.OPEN, isCompleted: false }, ["completed"]),
      false,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.OPEN, isCompleted: true }, ["completed"]),
      false,
    );
  });

  it("הושלם matches isCompleted only — not status text", () => {
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: true }, ["operationalCompleted"]),
      true,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: false }, ["operationalCompleted"]),
      false,
    );
  });

  it("בוצע + הושלם is OR and de-duplicates the same order", () => {
    const keys = toggleOrdersKpiFilter(["completed"], "operationalCompleted");
    assert.deepEqual(keys, ["completed", "operationalCompleted"]);
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: true }, keys),
      true,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: false }, keys),
      true,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.OPEN, isCompleted: true }, keys),
      true,
    );
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.OPEN, isCompleted: false }, keys),
      false,
    );
  });

  it("toggle off removes only that card", () => {
    const next = toggleOrdersKpiFilter(["completed", "operationalCompleted"], "completed");
    assert.deepEqual(next, ["operationalCompleted"]);
  });

  it("empty selection is הכל", () => {
    assert.equal(orderMatchesOrdersKpiFilters({ status: OS.OPEN, isCompleted: false }, []), true);
    assert.equal(serializeOrdersKpiFilters([]), "");
  });

  it("URL keeps both values without one overwriting the other", () => {
    const serialized = serializeOrdersKpiFilters(["completed", "operationalCompleted"]);
    assert.equal(serialized, "completed,operationalCompleted");
    const parsed = parseOrdersKpiFilters({ [ORDERS_KPI_PARAM]: serialized });
    assert.deepEqual(parsed, ["completed", "operationalCompleted"]);
    assert.equal(ORDERS_KPI_PARAM, "ordersKpi");
  });
});
