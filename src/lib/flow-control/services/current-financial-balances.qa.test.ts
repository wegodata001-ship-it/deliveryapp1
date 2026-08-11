/**
 * QA — יתרות נוכחיות (Balance) מצטברות, PS/IL נפרדים, עמלה בהעברה.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FxPurchaseRecord } from "@/app/admin/cash-flow/flow-types";
import {
  computeCurrentFinancialBalancesFromInput,
  computeTurkeySideBalanceUsd,
  type CumulativeBalanceInput,
} from "@/lib/flow-control/services/current-financial-balances.shared";
import type { TurkeyTransferMovementDto } from "@/lib/flow-control/turkey-transfer-balance-types";
import { signedMovementAmount } from "@/lib/flow-control/turkey-transfer-balance-service";

function fx(
  ils: number,
  usd: number,
  track: "PS" | "IL" = "PS",
): FxPurchaseRecord {
  return {
    id: `fx-${track}-${ils}`,
    track,
    ilsAmount: ils,
    usdReceived: usd,
    rate: ils / usd,
    remainderCashIls: 0,
    remainderBankIls: 0,
    createdAt: new Date().toISOString(),
  };
}

function mov(
  partial: Partial<TurkeyTransferMovementDto> & Pick<TurkeyTransferMovementDto, "weekCode" | "type" | "amount">,
): TurkeyTransferMovementDto {
  return {
    id: partial.id ?? "m1",
    currency: partial.currency ?? "USD",
    signedAmount: signedMovementAmount(partial.type, partial.amount),
    balanceBefore: null,
    balanceAfter: null,
    reference: null,
    notes: null,
    createdByName: null,
    createdAtIso: "2026-07-13T00:00:00.000Z",
    createdAtDisplay: "13/07/2026",
    ...partial,
  };
}

function input(partial: Partial<CumulativeBalanceInput>): CumulativeBalanceInput {
  const anchor: CumulativeBalanceInput["anchor"] = {
    weekCode: "AH-135",
    weekNum: 135,
    countedCashIls: 300,
    countedCashUsd: 0,
    countedTransferIls: null,
    countedCreditIls: null,
    countedChecksIls: null,
    bankBalanceIls: null,
    commissionUsd: 0,
    commissionIls: 0,
    fxPurchases: [],
    ...partial.anchor,
  };
  return {
    anchor,
    scopeRows: partial.scopeRows ?? [anchor],
    mergedFx: partial.mergedFx ?? [],
    totalExpensesIls: partial.totalExpensesIls ?? 0,
    bankDepositsIls: partial.bankDepositsIls ?? 0,
    bankWithdrawalsIls: partial.bankWithdrawalsIls ?? 0,
    commissions: partial.commissions ?? { usd: 0, ils: 0 },
    turkeyMovements: partial.turkeyMovements ?? [],
  };
}

describe("QA: יתרות נוכחיות — Balance SSOT", () => {
  it("רכישת מט״ח PS מורידה ₪ מהקופה", () => {
    const balances = computeCurrentFinancialBalancesFromInput(
      "TR",
      "AH-135",
      input({
        mergedFx: [fx(200, 60, "PS")],
      }),
    );
    assert.equal(balances.cashIls, 100);
    assert.equal(balances.psFx.purchased, 60);
    assert.equal(balances.psFx.available, 60);
  });

  it("העברה + עמלה מורידות PS זמין", () => {
    const balances = computeCurrentFinancialBalancesFromInput(
      "TR",
      "AH-135",
      input({
        mergedFx: [fx(200, 60, "PS")],
        commissions: { usd: 2, ils: 0 },
        turkeyMovements: [
          mov({ weekCode: "AH-135", type: "TRANSFER_TO_TURKEY", amount: 40 }),
        ],
      }),
    );
    assert.equal(balances.psFx.available, 18);
    assert.equal(balances.turkeyFxBalanceUsd, 40);
    assert.equal(balances.fxAvailableForTransferUsd, 18);
  });

  it("PS ו-IL נפרדים — לא מתמזגים", () => {
    const balances = computeCurrentFinancialBalancesFromInput(
      "TR",
      "AH-135",
      input({
        anchor: {
          weekCode: "AH-135",
          weekNum: 135,
          countedCashIls: 5000,
          countedCashUsd: 10,
          countedTransferIls: 2000,
          countedCreditIls: 0,
          countedChecksIls: 0,
          bankBalanceIls: null,
          commissionUsd: 0,
          commissionIls: 0,
          fxPurchases: [],
        },
        mergedFx: [fx(100, 40, "PS"), fx(500, 20, "IL")],
      }),
    );
    assert.equal(balances.psFx.purchased, 40);
    assert.equal(balances.ilFx.purchased, 20);
    assert.notEqual(balances.psFx.available, balances.ilFx.available + balances.psFx.available);
  });

  it("יתרה בטורקיה = העברות נטו, לא סה״כ היסטורי ללא הוצאות", () => {
    const movements = [
      mov({ weekCode: "AH-135", type: "TRANSFER_TO_TURKEY", amount: 50 }),
      mov({ weekCode: "AH-136", type: "MANUAL_ADJUSTMENT", amount: -10 }),
    ];
    assert.equal(computeTurkeySideBalanceUsd(movements), 40);
  });

  it("סה״כ מט״ח = PS + IL + בטורקיה", () => {
    const balances = computeCurrentFinancialBalancesFromInput(
      "TR",
      "AH-135",
      input({
        mergedFx: [fx(200, 60, "PS")],
        commissions: { usd: 2, ils: 0 },
        turkeyMovements: [
          mov({ weekCode: "AH-135", type: "TRANSFER_TO_TURKEY", amount: 40 }),
        ],
      }),
    );
    assert.equal(balances.totalFxUsd, round2(balances.psFx.available + balances.ilFx.available + balances.turkeyFxBalanceUsd));
  });

  it("100,000 − 15,000 FX − חוב בנק 50,000 = נטו 35,000", () => {
    const balances = computeCurrentFinancialBalancesFromInput(
      "TR",
      "AH-135",
      input({
        anchor: {
          weekCode: "AH-135",
          weekNum: 135,
          countedCashIls: 100_000,
          countedCashUsd: 0,
          countedTransferIls: null,
          countedCreditIls: null,
          countedChecksIls: null,
          bankBalanceIls: -50_000,
          commissionUsd: 0,
          commissionIls: 0,
          fxPurchases: [],
        },
        mergedFx: [fx(15_000, 100, "PS")],
      }),
    );
    assert.equal(balances.grossAvailableIls, 85_000);
    assert.equal(balances.bankBalanceIls, -50_000);
    assert.equal(balances.netAvailableIls, 35_000);
    assert.equal(balances.cashPosition.effectiveBankBalanceIls, 0);
    assert.equal(balances.psFx.purchased, 100);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
