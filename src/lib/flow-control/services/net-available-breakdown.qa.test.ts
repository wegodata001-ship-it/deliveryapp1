import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNetAvailableBreakdown } from "@/lib/flow-control/services/net-available-breakdown.shared";
import type { CumulativeBalanceInput } from "@/lib/flow-control/services/current-financial-balances.shared";

describe("QA: net available breakdown SSOT", () => {
  it("264.24 opening − 200 FX PS − 0 expenses = 64.24 gross (example)", () => {
    const input: CumulativeBalanceInput = {
      anchor: {
        weekCode: "AH-136",
        weekNum: 136,
        countedCashIls: 264.24,
        countedCashUsd: 0,
        countedTransferIls: 259.32,
        countedCreditIls: 0,
        countedChecksIls: 0,
        bankBalanceIls: null,
        commissionUsd: 0,
        commissionIls: 0,
        fxPurchases: [
          {
            id: "fx-1",
            track: "PS",
            ilsAmount: 200,
            usdReceived: 100,
            rate: 2,
            remainderCashIls: 64.24,
            remainderBankIls: 0,
            availableIlsBefore: 264.24,
            remainingIlsAfter: 64.24,
            createdAt: "2026-08-19T12:00:00.000Z",
            createdById: "u1",
          },
        ],
      },
      scopeRows: [],
      mergedFx: [
        {
          id: "fx-1",
          track: "PS",
          ilsAmount: 200,
          usdReceived: 100,
          rate: 2,
          remainderCashIls: 64.24,
          remainderBankIls: 0,
          availableIlsBefore: 264.24,
          remainingIlsAfter: 64.24,
          createdAt: "2026-08-19T12:00:00.000Z",
          createdById: "u1",
        },
      ],
      totalExpensesIls: 0,
      bankDepositsIls: 0,
      bankWithdrawalsIls: 0,
      commissions: { usd: 0, ils: 0 },
      turkeyMovements: [],
    };

    const gross = 64.24;
    const bank = 0;
    const net = 64.24;
    const bd = buildNetAvailableBreakdown(input, gross, bank, net);

    assert.equal(bd.grossAvailableIls, 64.24);
    assert.equal(bd.netAvailableIls, 64.24);
    const fxLine = bd.lines.find((l) => l.id === "fx-ps-out");
    assert.ok(fxLine?.isConversion);
    assert.equal(fxLine?.amount, 200);
  });

  it("net = gross + bank", () => {
    const input: CumulativeBalanceInput = {
      anchor: {
        weekCode: "AH-136",
        weekNum: 136,
        countedCashIls: 100,
        countedCashUsd: 0,
        countedTransferIls: 0,
        countedCreditIls: 0,
        countedChecksIls: 0,
        bankBalanceIls: -50,
        commissionUsd: 0,
        commissionIls: 0,
        fxPurchases: [],
      },
      scopeRows: [
        {
          weekCode: "AH-136",
          weekNum: 136,
          countedCashIls: 100,
          countedCashUsd: 0,
          countedTransferIls: 0,
          countedCreditIls: 0,
          countedChecksIls: 0,
          bankBalanceIls: -50,
          commissionUsd: 0,
          commissionIls: 0,
          fxPurchases: [],
        },
      ],
      mergedFx: [],
      totalExpensesIls: 0,
      bankDepositsIls: 0,
      bankWithdrawalsIls: 0,
      commissions: { usd: 0, ils: 0 },
      turkeyMovements: [],
    };

    const gross = 100;
    const bank = -50;
    const net = 50;
    const bd = buildNetAvailableBreakdown(input, gross, bank, net);
    assert.equal(bd.netAvailableIls, bd.grossAvailableIls + bd.bankBalanceIls);
  });
});
