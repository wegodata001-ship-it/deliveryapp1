import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OS } from "@/lib/order-status-slugs";
import { buildOrdersStatusSummaryFromGroups } from "@/lib/orders-status-kpi-summary";

function g(
  status: string,
  isCompleted: boolean,
  count: number,
  totalUsd = 100,
): Parameters<typeof buildOrdersStatusSummaryFromGroups>[0][number] {
  return { status, isCompleted, _count: { _all: count }, _sum: { totalUsd } };
}

describe("orders status KPI summary", () => {
  it("TEST 3/4: OPEN → COMPLETED → isCompleted moves the right counters", () => {
    const openOnly = buildOrdersStatusSummaryFromGroups([g(OS.OPEN, false, 1)]);
    assert.equal(openOnly.all.count, "1");
    assert.equal(openOnly.open.count, "1");
    assert.equal(openOnly.completed.count, "0");
    assert.equal(openOnly.operationalCompleted.count, "0");

    const afterDone = buildOrdersStatusSummaryFromGroups([g(OS.COMPLETED, false, 1)]);
    assert.equal(afterDone.all.count, "1");
    assert.equal(afterDone.open.count, "0");
    assert.equal(afterDone.completed.count, "1");
    assert.equal(afterDone.operationalCompleted.count, "0");

    const afterCompleted = buildOrdersStatusSummaryFromGroups([g(OS.COMPLETED, true, 1)]);
    assert.equal(afterCompleted.all.count, "1");
    assert.equal(afterCompleted.completed.count, "0");
    assert.equal(afterCompleted.operationalCompleted.count, "1");
  });

  it("does not double-count isCompleted inside בוצע", () => {
    const summary = buildOrdersStatusSummaryFromGroups([
      g(OS.COMPLETED, false, 2, 200),
      g(OS.COMPLETED, true, 5, 500),
      g(OS.OPEN, false, 1, 50),
    ]);
    assert.equal(summary.all.count, "8");
    assert.equal(summary.completed.count, "2");
    assert.equal(summary.operationalCompleted.count, "5");
    assert.equal(summary.open.count, "1");
  });

  it("waiting / in-progress slugs stay in ממתין לביצוע", () => {
    const summary = buildOrdersStatusSummaryFromGroups([
      g(OS.WAITING_FOR_EXECUTION, false, 3),
      g(OS.SENT, false, 1),
    ]);
    assert.equal(summary.inProgress.count, "4");
    assert.equal(summary.all.count, "4");
  });
});
