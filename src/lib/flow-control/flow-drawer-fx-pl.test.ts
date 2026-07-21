import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFlowWeekSummary,
  computeWeekIlsBalanceAfterOps,
  computeFxProfitLossHistory,
  weightedIntakeRateFromAllocations,
} from "@/lib/flow-control/flow-calculation-service";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";

describe("יתרת קופה אחרי כל הפעולות", () => {
  it("תקבולים − הוצאות − מט״ח PS − מט״ח IL", () => {
    const n = computeWeekIlsBalanceAfterOps({
      totalReceiptsIls: 105000,
      expensesIls: 0,
      fxPsIls: 90000,
      fxIlIls: 0,
    });
    assert.equal(n, 15000);
  });

  it("יתרת מזומן PS = מזומן PS − רכישות PS בלבד (ללא IL)", () => {
    const calc = computeFlowWeekSummary({
      countedCashUsd: 0,
      countedCashIls: 12000,
      expensesIls: 0,
      commissionUsd: 0,
      actualTurkeyTransfersUsd: 0,
      fxPurchases: [
        {
          id: "1",
          track: "PS",
          ilsAmount: 5000,
          usdReceived: 1250,
          rate: 4,
          remainderCashIls: 0,
          remainderBankIls: 0,
          createdAt: "2026-07-01T10:00:00.000Z",
        },
        {
          id: "2",
          track: "IL",
          ilsAmount: 90000,
          usdReceived: 22500,
          rate: 4,
          remainderCashIls: 0,
          remainderBankIls: 0,
          createdAt: "2026-07-01T11:00:00.000Z",
        },
      ],
      totalReceiptsIls: 105000,
      countedTransferIls: 90000,
      countedCreditIls: 0,
      countedChecksIls: 0,
    });
    assert.equal(calc.cashIlsInDrawer, 7000);
    assert.equal(calc.availableIlsForFx, 7000);
    assert.equal(calc.ilFxPurchaseIls, 90000);
  });
});

describe("רווח שער — קליטה מול רכישה", () => {
  it("weightedIntakeRateFromAllocations", () => {
    const r = weightedIntakeRateFromAllocations([
      {
        paymentId: "a",
        orderId: null,
        orderNumber: null,
        dateYmd: "2026-07-01",
        dateLabel: "01/07/2026",
        sourceLabel: "x",
        ilsAmount: 1000,
        intakeRate: 3.8,
        purchaseRate: 4.0,
        profitIls: 50,
      },
      {
        paymentId: "b",
        orderId: null,
        orderNumber: null,
        dateYmd: "2026-07-01",
        dateLabel: "01/07/2026",
        sourceLabel: "y",
        ilsAmount: 1000,
        intakeRate: 3.9,
        purchaseRate: 4.0,
        profitIls: 25,
      },
    ]);
    assert.equal(r, 3.85);
  });

  it("history row כולל שער קליטה והפרש", () => {
    const p: FxPurchaseRecord = {
      id: "fx1",
      ilsAmount: 2000,
      usdReceived: 500,
      rate: 4.03,
      remainderCashIls: 0,
      remainderBankIls: 0,
      createdAt: "2026-07-01T12:00:00.000Z",
      intakeAllocations: [
        {
          paymentId: "p1",
          orderId: null,
          orderNumber: "TR-1",
          dateYmd: "2026-07-01",
          dateLabel: "01/07/2026",
          sourceLabel: "TR-1",
          ilsAmount: 2000,
          intakeRate: 3.82,
          purchaseRate: 4.03,
          profitIls: 104.22,
        },
      ],
      intakeProfitIls: 104.22,
      intakeLossIls: 0,
    };
    const rows = computeFxProfitLossHistory([p]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.operationNumber, 1);
    assert.equal(rows[0]!.intakeRate, 3.82);
    assert.equal(rows[0]!.purchaseRate, 4.03);
    assert.ok((rows[0]!.rateDiff ?? 0) > 0.2);
    assert.ok(rows[0]!.profitIls > 0);
  });
});
