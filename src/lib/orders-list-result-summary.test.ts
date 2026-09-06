import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OS } from "@/lib/order-status-slugs";
import { buildOrdersResultSummary, moneyFromFilteredOrder } from "@/lib/orders-list-result-summary";

function row(
  id: string,
  status: string,
  opts: { isCompleted?: boolean; amount?: number; total?: number; paid?: number; commission?: number } = {},
) {
  return {
    id,
    status,
    isCompleted: opts.isCompleted ?? false,
    amountUsd: opts.amount ?? 100,
    commissionUsd: opts.commission ?? 10,
    totalUsd: opts.total ?? 110,
    paidUsd: opts.paid ?? 0,
  };
}

describe("buildOrdersResultSummary", () => {
  it("בוצע only — one line + unique total", () => {
    const rows = [
      row("1", OS.COMPLETED, { amount: 50, total: 55, paid: 10 }),
      row("2", OS.COMPLETED, { amount: 50, total: 55, paid: 5 }),
      row("3", OS.OPEN, { amount: 20, total: 22, paid: 0 }),
    ];
    const summary = buildOrdersResultSummary(rows.filter((r) => r.status === OS.COMPLETED), ["completed"]);
    assert.ok(summary);
    assert.equal(summary.lines.length, 1);
    assert.equal(summary.lines[0]!.key, "completed");
    assert.equal(summary.lines[0]!.count, 2);
    assert.equal(summary.lines[0]!.dealUsd, 100);
    assert.equal(summary.lines[0]!.totalUsd, 110);
    assert.equal(summary.total.count, 2);
    assert.equal(summary.total.dealUsd, 100);
    assert.equal(summary.total.balanceUsd, summary.lines[0]!.balanceUsd);
  });

  it("הושלם uses isCompleted, not status text", () => {
    const rows = [
      row("1", OS.COMPLETED, { isCompleted: true, amount: 30, total: 33, paid: 33 }),
      row("2", OS.COMPLETED, { isCompleted: false, amount: 70, total: 77, paid: 0 }),
    ];
    const filtered = rows.filter((r) => r.isCompleted);
    const summary = buildOrdersResultSummary(filtered, ["operationalCompleted"]);
    assert.ok(summary);
    assert.equal(summary.lines[0]!.key, "operationalCompleted");
    assert.equal(summary.lines[0]!.count, 1);
    assert.equal(summary.lines[0]!.dealUsd, 30);
    assert.equal(summary.total.count, 1);
  });

  it("בוצע + הושלם: overlapping rows, unique grand total", () => {
    const rows = [
      row("done", OS.COMPLETED, { isCompleted: false, amount: 10, total: 11, paid: 0 }),
      row("both", OS.COMPLETED, { isCompleted: true, amount: 6, total: 7, paid: 0 }),
    ];
    const summary = buildOrdersResultSummary(rows, ["completed", "operationalCompleted"]);
    assert.ok(summary);
    assert.equal(summary.lines.length, 2);
    assert.equal(summary.lines.find((l) => l.key === "completed")?.count, 2);
    assert.equal(summary.lines.find((l) => l.key === "operationalCompleted")?.count, 1);
    assert.equal(summary.total.count, 2);
    assert.equal(summary.total.dealUsd, 16);
    assert.equal(summary.lines.find((l) => l.key === "completed")?.dealUsd, 16);
    assert.equal(summary.lines.find((l) => l.key === "operationalCompleted")?.dealUsd, 6);
  });

  it("three selected statuses get three lines + unique total", () => {
    const rows = [
      row("1", OS.OPEN, { amount: 10, total: 11 }),
      row("2", OS.COMPLETED, { amount: 20, total: 22 }),
      row("3", OS.COMPLETED, { isCompleted: true, amount: 30, total: 33 }),
    ];
    const summary = buildOrdersResultSummary(rows, ["open", "completed", "operationalCompleted"]);
    assert.ok(summary);
    assert.equal(summary.lines.length, 3);
    assert.deepEqual(
      summary.lines.map((l) => l.key),
      ["open", "completed", "operationalCompleted"],
    );
    assert.equal(summary.total.count, 3);
    assert.equal(summary.total.dealUsd, 60);
  });

  it("הכל shows only buckets with results", () => {
    const rows = [
      row("1", OS.OPEN),
      row("2", OS.COMPLETED, { isCompleted: true }),
    ];
    const summary = buildOrdersResultSummary(rows, []);
    assert.ok(summary);
    const keys = summary.lines.map((l) => l.key);
    assert.ok(keys.includes("open"));
    assert.ok(keys.includes("completed"));
    assert.ok(keys.includes("operationalCompleted"));
    assert.ok(!keys.includes("cancelled"));
    assert.equal(summary.total.count, 2);
  });

  it("empty dataset has no summary", () => {
    assert.equal(buildOrdersResultSummary([], ["completed"]), null);
  });

  it("debt withdrawal keeps the same negative sign as the table", () => {
    const money = moneyFromFilteredOrder(
      row("dw", OS.DEBT_WITHDRAWAL, { amount: 80, total: 80, paid: 999 }),
    );
    assert.equal(money.dealUsd, -80);
    assert.equal(money.totalUsd, -80);
    assert.equal(money.balanceUsd, 0);
  });

  it("balance uses ledger SSOT, not total-paid invented in the UI", () => {
    const money = moneyFromFilteredOrder(
      row("1", OS.COMPLETED, { amount: 100, total: 110, commission: 10, paid: 40 }),
    );
    assert.equal(money.dealUsd, 100);
    assert.equal(money.totalUsd, 110);
    assert.equal(money.balanceUsd, 70);
  });
});
