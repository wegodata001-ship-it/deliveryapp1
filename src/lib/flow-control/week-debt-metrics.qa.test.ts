import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEEK_DEBT_METRICS_NOTE,
  WEEK_FIFO_COLLECTIBLE_DETAIL,
  WEEK_FIFO_COLLECTIBLE_LABEL,
  WEEK_ORDER_DEBT_DETAIL,
  WEEK_ORDER_DEBT_LABEL,
} from "@/lib/flow-control/week-debt-metrics";

describe("week debt metric labels", () => {
  it("keeps order debt and FIFO collectible as different names", () => {
    assert.notEqual(WEEK_ORDER_DEBT_LABEL, WEEK_FIFO_COLLECTIBLE_LABEL);
    assert.match(WEEK_ORDER_DEBT_LABEL, /לפני זכות/);
    assert.match(WEEK_FIFO_COLLECTIBLE_LABEL, /FIFO/);
  });

  it("explains that credit changes only the collectible balance", () => {
    assert.match(WEEK_ORDER_DEBT_DETAIL, /אינה מקוזזת/);
    assert.match(WEEK_FIFO_COLLECTIBLE_DETAIL, /יתרות זכות/);
    assert.match(WEEK_DEBT_METRICS_NOTE, /FIFO/);
    assert.notEqual(WEEK_ORDER_DEBT_DETAIL, WEEK_FIFO_COLLECTIBLE_DETAIL);
  });
});
