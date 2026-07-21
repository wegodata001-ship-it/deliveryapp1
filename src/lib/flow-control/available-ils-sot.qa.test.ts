/**
 * QA — זמין לרכישת מט״ח PS / IL נפרדים (ללא איחוד מסלולים)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFlowWeekSummary,
  computeIlAvailableIlsForFx,
  computePsAvailableIlsForFx,
} from "@/lib/flow-control/flow-calculation-service";
import {
  resolveAvailableIlIlsForFx,
  resolveAvailablePsIlsForFx,
} from "@/components/admin/manager-count/manager-count-utils";
import type { FlowWeekPayload, FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";

function fx(ilsAmount: number, track: "PS" | "IL" = "PS"): FxPurchaseRecord {
  return {
    id: `fx-${track}-${ilsAmount}`,
    track,
    ilsAmount,
    usdReceived: ilsAmount / 3.5,
    rate: 3.5,
    remainderCashIls: 0,
    remainderBankIls: 0,
    createdAt: new Date().toISOString(),
  };
}

function summary(opts: {
  countedCashIls?: number;
  fxPurchases?: FxPurchaseRecord[];
  transferIl?: number;
  creditIl?: number;
  checksIl?: number;
  expensesIls?: number;
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
    totalReceiptsIls: 0,
    bankReceiptsIls: 0,
  });
}

function flowFromCalc(
  calc: ReturnType<typeof computeFlowWeekSummary>,
  opts: {
    fxPurchases?: FxPurchaseRecord[];
    cashIls?: string;
    transferIl?: string;
    creditIl?: string;
    checksIl?: string;
  } = {},
): FlowWeekPayload {
  const money = (n: number) => n.toFixed(2);
  return {
    week: "AH-999",
    weekLabel: "QA",
    received: {} as FlowWeekPayload["received"],
    counted: {
      CASH_ILS: opts.cashIls ?? money(0),
      BANK_TRANSFER: opts.transferIl ?? money(0),
      CREDIT: opts.creditIl ?? money(0),
      CHECK: opts.checksIl ?? money(0),
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
      totalReceivedIls: "0.00",
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
    turkeyTransferIls: null,
    bankBalanceIls: money(calc.bankBalanceIls),
    bankBalanceUsd: null,
    drawerRemainingIls: money(calc.cashIlsInDrawer),
    drawerRemainingUsd: money(calc.cashUsdInDrawer),
    availableIlsForFx: money(calc.availableIlsForFx),
    availableIlIlsForFx: money(
      computeIlAvailableIlsForFx(
        Number(opts.transferIl ?? 0),
        Number(opts.creditIl ?? 0),
        Number(opts.checksIl ?? 0),
        opts.fxPurchases ?? [],
      ),
    ),
    turkeyExpectedUsd: money(calc.turkey.expectedUsd),
    turkeyDebtUsd: "0.00",
    turkeyDebtStatus: "ok",
    turkeyBalanceClosingUsd: "0.00",
    turkeyBalanceStatus: "NO_COUNT",
    ilFxPurchaseIls: money(calc.ilFxPurchaseIls),
    ilsRemainingAfterFx: money(calc.ilsRemainingAfterFx),
  };
}

describe("QA: הפרדת PS / IL בזמין לרכישת מט״ח", () => {
  it("PS בלבד — מזומן 10,000 ללא רכישות", () => {
    const calc = summary({ countedCashIls: 10000 });
    assert.equal(calc.availableIlsForFx, 10000);
    assert.equal(calc.ilsRemainingAfterFx, 10000);
    assert.equal(
      resolveAvailablePsIlsForFx(flowFromCalc(calc, { cashIls: "10000.00" })),
      "10000.00",
    );
  });

  it("רכישת PS 3,000 מורידה רק את מאגר PS", () => {
    const purchases = [fx(3000, "PS")];
    const calc = summary({ countedCashIls: 10000, fxPurchases: purchases, transferIl: 2000 });
    assert.equal(calc.availableIlsForFx, 7000);
    assert.equal(calc.ilFxPurchaseIls, 0);
    assert.equal(computeIlAvailableIlsForFx(2000, 0, 0, purchases), 2000);
  });

  it("רכישת IL לא מורידה את זמין PS", () => {
    const purchases = [fx(3000, "PS"), fx(2000, "IL")];
    const calc = summary({
      countedCashIls: 10000,
      fxPurchases: purchases,
      transferIl: 5000,
    });
    assert.equal(calc.availableIlsForFx, 7000);
    assert.equal(calc.ilFxPurchaseIls, 2000);
    assert.equal(computeIlAvailableIlsForFx(5000, 0, 0, purchases), 3000);
    assert.equal(
      resolveAvailableIlIlsForFx(
        flowFromCalc(calc, {
          fxPurchases: purchases,
          cashIls: "10000.00",
          transferIl: "5000.00",
        }),
      ),
      "3000.00",
    );
  });

  it("מאגר IL = העברות+אשראי+צ׳קים − רכישות IL בלבד", () => {
    const purchases = [fx(1500, "IL")];
    assert.equal(computeIlAvailableIlsForFx(1000, 800, 200, purchases), 500);
    assert.equal(computePsAvailableIlsForFx(9000, purchases), 9000);
  });

  it("SoT: availableIlsForFx === ilsRemainingAfterFx (מסלול PS)", () => {
    const calc = summary({
      countedCashIls: 8000,
      fxPurchases: [fx(1000, "PS")],
      transferIl: 5000,
      expensesIls: 9999,
    });
    assert.equal(calc.availableIlsForFx, calc.ilsRemainingAfterFx);
    assert.equal(calc.availableIlsForFx, 7000);
  });
});
