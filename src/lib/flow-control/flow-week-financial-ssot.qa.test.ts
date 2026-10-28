import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import {
  buildFlowWeekReceiptLayers,
  buildFlowWeekCashboxes,
  hasManagerCountSaved,
} from "@/lib/flow-control/flow-week-financial-ssot";
import type { FlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";
import { CASH_WEEK_FLOW_LINE_IDS } from "@/lib/cash-control-week-flow";

const emptyApproved = Object.fromEntries(
  CASH_WEEK_FLOW_LINE_IDS.map((id) => [id, { amount: 0, daysCounted: 0 }]),
);

const emptyCashCount: FlowWeekCashCount = {
  countedCashUsd: null,
  countedCashIls: null,
  countedChecksIls: null,
  countedCreditIls: null,
  countedTransferIls: null,
  commissionUsd: 0,
  commissionIls: 0,
  turkeyTransferUsd: null,
  turkeyTransferIls: null,
  expensesIls: 1000,
  expensesUsd: 0,
};

describe("flow-week-financial-ssot", () => {
  it("payment intake vs daily approved (AH-139 pattern)", () => {
    const intake = emptyDailyIntake();
    intake.CASH_ILS = 7000;
    intake.CASH_USD = 5345.5;
    const approved = { ...emptyApproved };
    approved.CASH_ILS = { amount: 6000, daysCounted: 1 };
    approved.CASH_USD = { amount: 5000, daysCounted: 1 };
    const layers = buildFlowWeekReceiptLayers({
      weekPaymentIntake: intake,
      approvedByLine: approved as Parameters<typeof buildFlowWeekReceiptLayers>[0]["approvedByLine"],
      countedLines: {},
      expensesByChannel: {},
      paymentRowCount: 3,
    });
    assert.equal(layers.actualReceipts.CASH_ILS.amount, 7000);
    assert.equal(layers.dailyApproved.CASH_ILS.amount, 6000);
  });

  it("no manager count — no drawer balance (AH-139)", () => {
    assert.equal(hasManagerCountSaved(emptyCashCount), false);
    const boxes = buildFlowWeekCashboxes({
      cashCount: emptyCashCount,
      openingUsd: null,
      openingIls: null,
      openingVerified: false,
      openingMessageHe: "לא מאומת",
      prevWeek: "AH-138",
      inflowCashUsd: 0,
      inflowCashIls: 0,
      fxUsdIn: 0,
      fxIlsOut: 0,
      turkeyOutUsd: 0,
      bankOutIls: 0,
      expensesIls: 1000,
      expensesUsd: 0,
      drawerUsdWhenCounted: null,
      drawerIlsWhenCounted: null,
    });
    assert.equal(boxes.managerCountState, "NONE");
    assert.equal(boxes.ils.drawerBalance, null);
  });
});
