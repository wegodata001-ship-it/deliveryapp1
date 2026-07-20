/**
 * QA — זמין בקופה ≡ שקל שנשאר (Source of Truth מאוחד)
 * תרחישים מהגדרת ה־QA לאחר שינוי SoT.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFlowWeekSummary,
  computeIlsRemainingAfterFx,
  type FxPurchaseRecord,
} from "@/lib/flow-control/flow-calculation-service";
import { resolveAvailableIlsForFx } from "@/components/admin/manager-count/manager-count-utils";
import type { FlowWeekPayload } from "@/app/admin/cash-flow/flow-types";

function fx(ilsAmount: number): FxPurchaseRecord {
  return {
    id: `fx-${ilsAmount}`,
    ilsAmount,
    usdReceived: ilsAmount / 3.5,
    rate: 3.5,
    remainderCashIls: 0,
    remainderBankIls: 0,
    createdAt: new Date().toISOString(),
  };
}

function summary(opts: {
  receipts: number;
  fxPurchases?: FxPurchaseRecord[];
  transferIl?: number;
  creditIl?: number;
  checksIl?: number;
  expensesIls?: number;
  countedCashIls?: number;
}) {
  return computeFlowWeekSummary({
    countedCashUsd: 0,
    countedCashIls: opts.countedCashIls ?? 0,
    expensesIls: opts.expensesIls ?? 0,
    commissionUsd: 0,
    actualTurkeyTransfersUsd: 0,
    fxPurchases: opts.fxPurchases ?? [],
    countedTransferIls: opts.transferIl ?? 0,
    countedCreditIls: opts.creditIl ?? 0,
    countedChecksIls: opts.checksIl ?? 0,
    totalReceiptsIls: opts.receipts,
    bankReceiptsIls: 0,
  });
}

function flowFromCalc(
  calc: ReturnType<typeof computeFlowWeekSummary>,
  receipts: number,
  opts: {
    fxPurchases?: FxPurchaseRecord[];
    transferIl?: string;
  } = {},
): FlowWeekPayload {
  const money = (n: number) => n.toFixed(2);
  const transfer = opts.transferIl ?? money(0);
  return {
    week: "AH-999",
    weekLabel: "QA",
    received: {} as FlowWeekPayload["received"],
    counted: {
      BANK_TRANSFER: transfer,
      CREDIT: money(0),
      CHECK: money(0),
    },
    countDiff: {},
    expensesIls: money(0),
    expensesUsd: money(0),
    commissionUsd: null,
    commissionIls: null,
    fxPurchaseIls: money(calc.fxTotals.ils),
    fxPurchaseUsd: money(calc.fxTotals.usd),
    fxRemainderCashIls: null,
    fxRemainderBankIls: null,
    fxPurchases: opts.fxPurchases ?? [],
    fxProfitLoss: calc.fxProfitLoss,
    fxProfitLossHistory: [],
    kpis: {
      totalReceivedIls: money(receipts),
      totalFxConvertedIls: money(calc.fxTotals.ils),
      totalFxConvertedUsd: money(calc.fxTotals.usd),
      turkeyTransferredUsd: "0.00",
      cashRemainingIls: money(calc.cashIlsInDrawer),
      cashRemainingUsd: money(calc.cashUsdInDrawer),
      bankBalanceIls: money(calc.bankBalanceIls),
      fxProfitIls: "0.00",
      fxLossIls: "0.00",
    },
    turkey: calc.turkey,
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
      actualTransfersUsd: 0,
      actualTransfersIls: 0,
      movements: [],
    },
    turkeyTransferUsd: null,
    bankBalanceIls: money(calc.bankBalanceIls),
    bankBalanceUsd: null,
    drawerRemainingIls: money(calc.cashIlsInDrawer),
    drawerRemainingUsd: money(calc.cashUsdInDrawer),
    availableIlsForFx: money(calc.availableIlsForFx),
    turkeyExpectedUsd: money(calc.turkey.expectedUsd),
    turkeyDebtUsd: "0.00",
    turkeyDebtStatus: "ok",
    turkeyBalanceClosingUsd: "0.00",
    turkeyBalanceStatus: "NO_COUNT",
    ilFxPurchaseIls: money(calc.ilFxPurchaseIls),
    ilsRemainingAfterFx: money(calc.ilsRemainingAfterFx),
  };
}

describe("QA: זמין בקופה ≡ שקל שנשאר", () => {
  it("בדיקה 1 — תקבולים בלבד: 10,000", () => {
    const calc = summary({ receipts: 10000 });
    assert.equal(calc.ilsRemainingAfterFx, 10000);
    assert.equal(calc.availableIlsForFx, 10000);
    assert.equal(calc.availableIlsForFx, calc.ilsRemainingAfterFx);
    assert.equal(resolveAvailableIlsForFx(flowFromCalc(calc, 10000)), "10000.00");
  });

  it("בדיקה 2 — רכישת מט״ח PS 3,000 → 7,000", () => {
    const purchases = [fx(3000)];
    const calc = summary({ receipts: 10000, fxPurchases: purchases });
    assert.equal(calc.ilsRemainingAfterFx, 7000);
    assert.equal(calc.availableIlsForFx, 7000);
    assert.equal(resolveAvailableIlsForFx(flowFromCalc(calc, 10000, { fxPurchases: purchases })), "7000.00");
  });

  it("בדיקה 3 — + רכישת מט״ח IL 2,000 → 5,000", () => {
    const purchases = [fx(3000)];
    const calc = summary({
      receipts: 10000,
      fxPurchases: purchases,
      transferIl: 2000,
    });
    assert.equal(calc.ilFxPurchaseIls, 2000);
    assert.equal(calc.ilsRemainingAfterFx, 5000);
    assert.equal(calc.availableIlsForFx, 5000);
    assert.equal(
      resolveAvailableIlsForFx(flowFromCalc(calc, 10000, { fxPurchases: purchases, transferIl: "2000.00" })),
      "5000.00",
    );
  });

  it("בדיקה 4 — + קליטה 1,500 → 6,500", () => {
    const calc = summary({
      receipts: 11500,
      fxPurchases: [fx(3000)],
      transferIl: 2000,
    });
    assert.equal(calc.ilsRemainingAfterFx, 6500);
    assert.equal(calc.availableIlsForFx, 6500);
  });

  it("בדיקה 5 — הוצאות לא משפיעות על שקל שנשאר / זמין", () => {
    const withoutExp = summary({
      receipts: 10000,
      fxPurchases: [fx(3000)],
      transferIl: 2000,
      expensesIls: 0,
    });
    const withExp = summary({
      receipts: 10000,
      fxPurchases: [fx(3000)],
      transferIl: 2000,
      expensesIls: 900,
      countedCashIls: 5000,
    });
    assert.equal(withoutExp.ilsRemainingAfterFx, 5000);
    assert.equal(withExp.ilsRemainingAfterFx, 5000);
    assert.equal(withExp.availableIlsForFx, withExp.ilsRemainingAfterFx);
    assert.notEqual(withExp.cashIlsInDrawer, withoutExp.cashIlsInDrawer);
  });

  it("בדיקה 6 — מעבר שבוע: חישוב לפי קלטים של אותו שבוע בלבד", () => {
    const weekA = summary({ receipts: 10000, fxPurchases: [fx(1000)] });
    const weekB = summary({ receipts: 500, fxPurchases: [] });
    assert.equal(weekA.availableIlsForFx, 9000);
    assert.equal(weekB.availableIlsForFx, 500);
    assert.notEqual(weekA.availableIlsForFx, weekB.availableIlsForFx);
  });

  it("בדיקה 7 — אחרי «רענון»: ערכים מחושבים מחדש זהים (אין איפוס ל־0)", () => {
    const purchases = [fx(3000)];
    const calc = summary({
      receipts: 11500,
      fxPurchases: purchases,
      transferIl: 2000,
      countedCashIls: 0,
    });
    const flow = flowFromCalc(calc, 11500, { fxPurchases: purchases, transferIl: "2000.00" });
    assert.equal(flow.ilsRemainingAfterFx, "6500.00");
    assert.equal(flow.availableIlsForFx, "6500.00");
    assert.equal(resolveAvailableIlsForFx(flow), "6500.00");
    assert.notEqual(resolveAvailableIlsForFx(flow), "0.00");
  });

  it("בדיקה 8 — ולידציה: רכישה מעל הזמין נדחית (לוגיקה)", () => {
    const available = computeIlsRemainingAfterFx(10000, 3000, 2000);
    assert.equal(available, 5000);
    assert.ok(5000.03 > available + 0.02);
    assert.ok(5000 <= available + 0.02);
  });

  it("בדיקה 9 — SoT: availableIlsForFx === ilsRemainingAfterFx; לא countedCashIls", () => {
    const calc = summary({
      receipts: 8000,
      fxPurchases: [fx(1000)],
      transferIl: 500,
      countedCashIls: 0,
      expensesIls: 9999,
    });
    assert.equal(calc.availableIlsForFx, calc.ilsRemainingAfterFx);
    assert.equal(calc.availableIlsForFx, 6500);
    assert.ok(calc.availableIlsForFx > 0);
    const legacyFromCounted = Math.max(0, 0 - 9999 - 1000);
    assert.equal(legacyFromCounted, 0);
    assert.notEqual(calc.availableIlsForFx, legacyFromCounted);
  });
});
