import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  orderUpdateChargeDeltaUsd,
  reconstructOriginalOrderChargeUsd,
  sumDeltasOnOrAfter,
} from "@/lib/ledger-order-version-charge";

describe("orderUpdateChargeDeltaUsd", () => {
  it("increase amount only — +144.50", () => {
    const delta = orderUpdateChargeDeltaUsd([
      { field: "amountUsd", before: "$555.50", after: "$700.00" },
      { field: "status", before: "חדש", after: "אושר" },
    ]);
    assert.equal(delta, 144.5);
  });

  it("decrease amount — -155.50", () => {
    const delta = orderUpdateChargeDeltaUsd([
      { field: "amountUsd", before: "$555.50", after: "$400.00" },
    ]);
    assert.equal(delta, -155.5);
  });

  it("amount + commission together", () => {
    const delta = orderUpdateChargeDeltaUsd([
      { field: "amountUsd", before: "$100.00", after: "$120.00" },
      { field: "feeUsd", before: "$15.00", after: "$18.00" },
    ]);
    assert.equal(delta, 23);
  });

  it("non-money update is 0", () => {
    assert.equal(
      orderUpdateChargeDeltaUsd([{ field: "notes", before: "a", after: "b" }]),
      0,
    );
  });
});

describe("reconstructOriginalOrderChargeUsd", () => {
  it("one increase: current 700, delta +144.50 → original 555.50", () => {
    assert.equal(reconstructOriginalOrderChargeUsd(700, [144.5]), 555.5);
  });

  it("one decrease: current 400, delta -155.50 → original 555.50", () => {
    assert.equal(reconstructOriginalOrderChargeUsd(400, [-155.5]), 555.5);
  });

  it("multiple updates: 555.50 → 700 → 400", () => {
    const deltas = [144.5, -300];
    assert.equal(reconstructOriginalOrderChargeUsd(400, deltas), 555.5);
    assert.equal(Number((555.5 + 144.5 - 300).toFixed(2)), 400);
  });

  it("no deltas → original equals current SSOT", () => {
    assert.equal(reconstructOriginalOrderChargeUsd(555.5, []), 555.5);
  });
});

describe("running balance from original + deltas (SSOT current)", () => {
  function run(rows: Array<{ charge: number; payment: number }>): number[] {
    let balance = 0;
    return rows.map((r) => {
      balance = Number((balance + r.charge - r.payment).toFixed(2));
      return balance;
    });
  }

  it("order + increase + payment", () => {
    const current = 700;
    const delta = 144.5;
    const original = reconstructOriginalOrderChargeUsd(current, [delta]);
    assert.deepEqual(run([
      { charge: original, payment: 0 },
      { charge: delta, payment: 0 },
      { charge: 0, payment: 200 },
    ]), [555.5, 700, 500]);
  });

  it("order + decrease ends at current SSOT", () => {
    const current = 400;
    const delta = -155.5;
    const original = reconstructOriginalOrderChargeUsd(current, [delta]);
    const balances = run([
      { charge: original, payment: 0 },
      { charge: delta, payment: 0 },
    ]);
    assert.equal(original, 555.5);
    assert.equal(balances[1], current);
  });
});

describe("sumDeltasOnOrAfter", () => {
  it("opening uses only in-range deltas so current-inRange = historical at from", () => {
    const updates = [
      { atMs: 10, deltaUsd: 144.5 },
      { atMs: 20, deltaUsd: -50 },
    ];
    assert.equal(sumDeltasOnOrAfter(updates, 15), -50);
    assert.equal(reconstructOriginalOrderChargeUsd(650, [sumDeltasOnOrAfter(updates, 15)]), 700);
  });
});
