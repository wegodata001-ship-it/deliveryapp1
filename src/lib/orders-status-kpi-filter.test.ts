import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OS } from "@/lib/order-status-slugs";
import { buildOrdersKpiWhere } from "@/app/admin/orders/orders-list-where";
import {
  ORDERS_KPI_PARAM,
  orderMatchesOrdersKpiFilters,
  parseOrdersKpiFilters,
  serializeOrdersKpiFilters,
  toggleOrdersKpiFilter,
} from "@/lib/orders-status-kpi-filter";

const A = { id: "A", status: OS.COMPLETED, isCompleted: false };
const B = { id: "B", status: OS.COMPLETED, isCompleted: false };
const C = { id: "C", status: OS.COMPLETED, isCompleted: true };
const D = { id: "D", status: OS.COMPLETED, isCompleted: true };
const E = { id: "E", status: OS.OPEN, isCompleted: false };
const SAMPLE = [A, B, C, D, E];

function idsMatching(keys: Parameters<typeof orderMatchesOrdersKpiFilters>[1]): string[] {
  return SAMPLE.filter((row) => orderMatchesOrdersKpiFilters(row, keys)).map((row) => row.id);
}

describe("orders KPI multi-select", () => {
  it("TEST 1: בוצע only returns A+B, not הושלם or פתוח", () => {
    assert.deepEqual(idsMatching(["completed"]), ["A", "B"]);
  });

  it("TEST 2: הושלם only returns C+D, not בוצע or פתוח", () => {
    assert.deepEqual(idsMatching(["operationalCompleted"]), ["C", "D"]);
  });

  it("TEST 3: בוצע + הושלם is an explicit UNION — A+B+C+D, not E", () => {
    const keys = toggleOrdersKpiFilter(["completed"], "operationalCompleted");
    assert.deepEqual(keys, ["completed", "operationalCompleted"]);
    assert.deepEqual(idsMatching(keys), ["A", "B", "C", "D"]);
  });

  it("TEST 4: refresh keeps exact ordersKpi=completed semantics", () => {
    const serialized = serializeOrdersKpiFilters(["completed"]);
    assert.equal(serialized, "completed");
    const parsed = parseOrdersKpiFilters({ [ORDERS_KPI_PARAM]: serialized });
    assert.deepEqual(parsed, ["completed"]);
    assert.deepEqual(idsMatching(parsed), ["A", "B"]);
  });

  it("בוצע does not expand to הושלם", () => {
    assert.equal(
      orderMatchesOrdersKpiFilters({ status: OS.COMPLETED, isCompleted: true }, ["completed"]),
      false,
    );
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

  it("Prisma where for בוצע excludes isCompleted", () => {
    assert.deepEqual(buildOrdersKpiWhere(["completed"]), {
      status: OS.COMPLETED,
      isCompleted: false,
    });
    assert.deepEqual(buildOrdersKpiWhere(["operationalCompleted"]), { isCompleted: true });
    const both = buildOrdersKpiWhere(["completed", "operationalCompleted"]);
    assert.deepEqual(both, {
      OR: [
        { status: OS.COMPLETED, isCompleted: false },
        { isCompleted: true },
      ],
    });
  });
});
