import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flowCountStatusLabel,
  summarizeFlowControlStatus,
} from "@/lib/flow-control/flow-control-status";

describe("flow control status badge", () => {
  it("waiting for count is not a financial anomaly", () => {
    const summary = summarizeFlowControlStatus([
      { cashControlStatus: "WAITING_FOR_COUNT" },
      { cashControlStatus: "WAITING_FOR_COUNT" },
      { cashControlStatus: "MATCHED" },
    ]);
    assert.equal(summary.financialCount, 0);
    assert.equal(summary.waitingCount, 2);
    assert.equal(summary.tone, "warn");
    assert.equal(summary.label, "ממתין לספירה · 2");
  });

  it("shortage and surplus stay financial and separate", () => {
    const shortage = summarizeFlowControlStatus([{ cashControlStatus: "SHORTAGE" }]);
    assert.equal(shortage.financialCount, 1);
    assert.equal(shortage.label, "חוסר · 1");
    assert.equal(shortage.tone, "critical");

    const surplus = summarizeFlowControlStatus([{ cashControlStatus: "SURPLUS" }]);
    assert.equal(surplus.label, "עודף · 1");
    assert.equal(surplus.financialCount, 1);

    const both = summarizeFlowControlStatus([
      { cashControlStatus: "SHORTAGE" },
      { cashControlStatus: "SURPLUS" },
      { cashControlStatus: "WAITING_FOR_COUNT" },
    ]);
    assert.equal(both.financialCount, 2);
    assert.equal(both.waitingCount, 1);
    assert.equal(both.label, "חוסר 1 · עודף 1");
  });

  it("a full match is matched", () => {
    const summary = summarizeFlowControlStatus([
      { cashControlStatus: "MATCHED" },
      { cashControlStatus: "MATCHED" },
    ]);
    assert.equal(summary.tone, "ok");
    assert.equal(summary.label, "תואם");
    assert.equal(flowCountStatusLabel("WAITING_FOR_COUNT"), "ממתין לספירה");
    assert.equal(flowCountStatusLabel("MATCHED"), "תואם");
  });
});
