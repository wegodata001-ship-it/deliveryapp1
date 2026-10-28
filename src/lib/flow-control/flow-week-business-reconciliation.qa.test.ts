import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowWeekDrillPayload } from "@/app/admin/cash-flow/flow-types";
import { allCashControlChannels } from "@/lib/cash-control-channel";
import { emptyDailyIntake } from "@/lib/cash-control-daily";
import {
  buildFlowWeekCashboxes,
  buildFlowWeekReceiptLayers,
} from "@/lib/flow-control/flow-week-financial-ssot";
import type { FlowWeekCashCount } from "@/lib/flow-control/services/cash-count-service";
import {
  buildFlowBusinessReconciliation,
  countVerifiedFlowExceptions,
  isVerifiedChannelVariance,
} from "@/lib/flow-control/flow-week-business-reconciliation";
import { getFlowWeekVarianceLines } from "@/lib/flow-control/services/flow-variance.service";
import { CASH_WEEK_FLOW_LINE_IDS } from "@/lib/cash-control-week-flow";

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
  expensesIls: 0,
  expensesUsd: 0,
};

const emptyApproved = Object.fromEntries(
  CASH_WEEK_FLOW_LINE_IDS.map((id) => [id, { amount: 0, daysCounted: 0 }]),
);

function makeDrill(opts: {
  intakeIls?: number;
  countedCashIls?: string | null;
  managerComplete?: boolean;
}): FlowWeekDrillPayload {
  const intake = emptyDailyIntake();
  if (opts.intakeIls) intake.CASH_ILS = opts.intakeIls;
  const layers = buildFlowWeekReceiptLayers({
    weekPaymentIntake: intake,
    approvedByLine: emptyApproved as Parameters<typeof buildFlowWeekReceiptLayers>[0]["approvedByLine"],
    countedLines: opts.countedCashIls != null ? { CASH_ILS: Number(opts.countedCashIls) } : {},
    expensesByChannel: {},
    paymentRowCount: 1,
  });
  const cashCount: FlowWeekCashCount = opts.managerComplete
    ? {
        ...emptyCashCount,
        countedCashUsd: 0,
        countedCashIls: Number(opts.countedCashIls ?? 0),
        countedChecksIls: 0,
        countedCreditIls: 0,
        countedTransferIls: 0,
      }
    : emptyCashCount;
  const cashboxes = buildFlowWeekCashboxes({
    cashCount,
    openingUsd: 0,
    openingIls: 0,
    openingVerified: true,
    openingMessageHe: "מאומת לבדיקה",
    prevWeek: null,
    inflowCashUsd: 0,
    inflowCashIls: opts.intakeIls ?? 0,
    fxUsdIn: 0,
    fxIlsOut: 0,
    turkeyOutUsd: 0,
    bankOutIls: 0,
    expensesIls: 0,
    expensesUsd: 0,
    drawerUsdWhenCounted: null,
    drawerIlsWhenCounted: null,
  });
  const paymentIntake = Object.fromEntries(
    allCashControlChannels().map((id) => [id, String(intake[id] ?? 0)]),
  ) as FlowWeekDrillPayload["paymentIntake"];

  return {
    week: "AH-139",
    weekLabel: null,
    dailyCounts: [],
    paymentDailyRows: [],
    expenses: [],
    paymentIntake,
    meta: { updatedAtDisplay: null, updatedByName: null },
    flow: {
      week: "AH-139",
      cashWeekFlowId: null,
      weekLabel: null,
      received: layers.actualReceipts as never,
      receiptLayers: layers,
      weekContext: {
        paymentsReceivedInWeek: 1,
        paymentsByWeekCodeOnly: 1,
        ordersInOrderWeek: 0,
      },
      managerCountState: cashboxes.managerCountState,
      cashboxes,
      counted: opts.countedCashIls != null ? { CASH_ILS: opts.countedCashIls } : {},
      countDiff: Object.fromEntries(
        Object.entries(layers.countDiff).map(([k, v]) => [k, v == null ? null : String(v)]),
      ),
      expensesIls: "0",
      expensesUsd: "0",
      commissionUsd: null,
      commissionIls: null,
      fxPurchaseIls: null,
      fxPurchaseUsd: null,
      fxRemainderCashIls: null,
      fxRemainderBankIls: null,
      fxPurchases: [],
      fxProfitLoss: {
        purchases: [],
        totalProfitIls: 0,
        totalLossIls: 0,
        avgRate: 0,
        cumulativeUsd: 0,
        cumulativeIls: 0,
        maxBarAmount: 0,
      },
      fxProfitLossHistory: [],
      kpis: {} as never,
      turkey: {} as never,
      turkeyBalance: {
        usd: {
          currency: "USD",
          openingBalance: 0,
          addedFromCashCount: 0,
          adjusted: 0,
          transferred: 0,
          reversed: 0,
          closingBalance: 0,
          status: "NO_COUNT",
        },
        ils: {
          currency: "ILS",
          openingBalance: 0,
          addedFromCashCount: 0,
          adjusted: 0,
          transferred: 0,
          reversed: 0,
          closingBalance: 0,
          status: "NO_COUNT",
        },
        movements: [],
        actualTransfersUsd: 0,
        actualTransfersIls: 0,
      },
      turkeyTransferUsd: null,
      turkeyTransferIls: null,
      bankBalanceIls: null,
      bankBalanceUsd: null,
      drawerRemainingIls: null,
      drawerRemainingUsd: null,
      availableIlsForFx: "0",
      availableIlIlsForFx: "0",
      turkeyExpectedUsd: "0",
      turkeyDebtUsd: "0",
      turkeyDebtStatus: "ok",
      turkeyBalanceClosingUsd: "0",
      turkeyBalanceStatus: "NO_COUNT",
      ilFxPurchaseIls: "0",
      ilsRemainingAfterFx: "0",
      weekPaymentIntake: intake,
      managerCountExpected: [],
      drawerChannelTotals: emptyDailyIntake(),
    },
  };
}

describe("flow-week-business-reconciliation", () => {
  it("AH-139: week without manager count — variance lines exist but verified exceptions = 0", () => {
    const drill = makeDrill({ intakeIls: 7000 });
    const lines = getFlowWeekVarianceLines(drill);
    assert.ok(lines.length >= 6);
    const waiting = lines.filter((l) => l.cashControlStatus === "WAITING_FOR_COUNT");
    assert.ok(waiting.length > 0, "channels without count stay WAITING_FOR_COUNT");
    assert.equal(countVerifiedFlowExceptions(drill), 0);
    for (const l of waiting) {
      assert.equal(isVerifiedChannelVariance(l), false);
    }
    const recon = buildFlowBusinessReconciliation({ drill, overview: null, week: "AH-139" });
    assert.equal(recon.verifiedExceptionCount, 0);
    assert.ok(
      !recon.rows.some((r) => r.group === "COUNT" && r.status === "VERIFIED_EXCEPTION"),
      "no fake channel exceptions in modal rows",
    );
  });

  it("verified shortage when manager count complete", () => {
    const drill = makeDrill({ intakeIls: 7000, countedCashIls: "6000", managerComplete: true });
    assert.ok(countVerifiedFlowExceptions(drill) >= 1);
    const recon = buildFlowBusinessReconciliation({ drill, overview: null, week: "AH-139" });
    assert.ok(recon.verifiedExceptionCount >= 1);
  });
});
