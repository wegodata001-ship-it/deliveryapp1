import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeBalanceSnapshotWithPreserved,
  mergeSnapshotPatch,
  readCashboxClosing,
} from "@/lib/flow-control/week-balance-snapshot-merge";

describe("week-balance-snapshot-merge", () => {
  it("preserves managerCountHistory on balance confirm merge", () => {
    const balance = { weekCode: "AH-141", ils: {}, usd: {}, dataHash: "x" };
    const existing = {
      managerCountHistory: [{ id: "1", savedAt: "t", savedById: "u", formBefore: {}, formAfter: {}, status: "SAVED" }],
      cashboxClosing: { usd: 1, ils: 2, verified: true, savedAt: "t", weekCode: "AH-140", source: "MANAGER_COUNT" },
    };
    const merged = mergeBalanceSnapshotWithPreserved(balance as never, existing);
    assert.ok(Array.isArray(merged.managerCountHistory));
    assert.equal((merged.cashboxClosing as { usd: number }).usd, 1);
  });

  it("readCashboxClosing requires verified", () => {
    const c = readCashboxClosing({
      cashboxClosing: { usd: 10, ils: 20, verified: true, savedAt: "t", weekCode: "AH-140", source: "MANAGER_COUNT" },
    });
    assert.equal(c?.usd, 10);
    assert.equal(readCashboxClosing({ cashboxClosing: { usd: 1, ils: 1, verified: false } }), null);
  });

  it("mergeSnapshotPatch appends history without dropping keys", () => {
    const out = mergeSnapshotPatch({ foo: 1 }, { managerCountHistory: [] });
    assert.equal(out.foo, 1);
  });
});
