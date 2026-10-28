import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import {
  aggregateTrackIntakeFromTotals,
  resolveCashFlowTrack,
  resolveCashFlowTrackFromChannel,
} from "@/lib/flow-control/cash-flow-track-ssot";
import { dueCollectionWeekForOrderWeek, orderWeekForDueCollectionWeek } from "@/lib/flow-control/flow-week-due-orders";

describe("cash-flow-track-ssot", () => {
  it("PS = cash only", () => {
    assert.equal(resolveCashFlowTrackFromChannel("CASH_USD"), "PS");
    assert.equal(resolveCashFlowTrackFromChannel("CASH_ILS"), "PS");
    assert.equal(resolveCashFlowTrackFromChannel("BANK_TRANSFER_USD"), "IL");
    assert.equal(resolveCashFlowTrack("CASH", "USD"), "PS");
    assert.equal(resolveCashFlowTrack("BANK_TRANSFER", "USD"), "IL");
  });

  it("complex payment split $300 cash + $700 transfer", () => {
    const intake = emptyDailyIntake();
    intake.CASH_USD = 300;
    intake.BANK_TRANSFER_USD = 700;
    const t = aggregateTrackIntakeFromTotals(intake);
    assert.equal(t.ps.usd, 300);
    assert.equal(t.il.usd, 700);
    assert.equal(t.ps.ils, 0);
  });

  it("due week N+1", () => {
    assert.equal(dueCollectionWeekForOrderWeek("AH-145"), "AH-146");
    assert.equal(orderWeekForDueCollectionWeek("AH-146"), "AH-145");
  });
});
