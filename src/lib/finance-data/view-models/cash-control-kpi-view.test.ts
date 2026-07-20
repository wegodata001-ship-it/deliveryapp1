import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCashControlKpiView } from "@/lib/finance-data/view-models/cash-control-kpi-view";

describe("buildCashControlKpiView", () => {
  it("sums all receipt channels per currency", () => {
    const kpi = buildCashControlKpiView({
      weekCode: "AH-128",
      channelIntake: {
        CASH_USD: 10,
        BANK_TRANSFER_USD: 20,
        CREDIT_CARD_USD: 5,
        CHECK_USD: 3,
        OTHER_USD: 2,
        CASH_ILS: 100,
        BANK_TRANSFER_ILS: 200,
        CREDIT_CARD_ILS: 50,
        CHECK_ILS: 30,
        OTHER_ILS: 20,
      },
      expensesUsd: 7.5,
      expensesIls: 40,
    });

    assert.equal(kpi.totalReceiptsUsd, 40);
    assert.equal(kpi.totalReceiptsIls, 400);
    assert.equal(kpi.totalExpensesUsd, 7.5);
    assert.equal(kpi.totalExpensesIls, 40);
  });

  it("bank paid excludes cash, other, credit balance and commissions", () => {
    const kpi = buildCashControlKpiView({
      weekCode: "AH-128",
      channelIntake: {
        CASH_USD: 100,
        CASH_ILS: 500,
        BANK_TRANSFER_USD: 10,
        BANK_TRANSFER_ILS: 20,
        CREDIT_CARD_USD: 30,
        CREDIT_CARD_ILS: 40,
        CHECK_USD: 5,
        CHECK_ILS: 15,
        OTHER_USD: 99,
        OTHER_ILS: 88,
      },
      expensesUsd: 0,
      expensesIls: 0,
    });

    assert.equal(kpi.bankPaidUsd, 45); // 10+30+5
    assert.equal(kpi.bankPaidIls, 75); // 20+40+15
    assert.equal(kpi.totalReceiptsUsd, 244); // includes cash+other
    assert.equal(kpi.totalReceiptsIls, 663);
  });
});
