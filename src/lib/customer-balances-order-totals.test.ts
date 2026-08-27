import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  orderBeforeCommissionUsd,
  orderCustomerChargeUsd,
  orderCustomerCreditUsd,
} from "@/lib/debt-withdrawal-order";
import { orderUsdTotalsFromFields } from "@/lib/customer-balances-order-totals";
import { OS } from "@/lib/order-status-slugs";

describe("customer-balances order USD totals SSOT", () => {
  it("regular order: before < after when commission > 0", () => {
    const o = {
      status: OS.OPEN,
      amountUsd: 10_000,
      commissionUsd: 200,
      totalUsd: 10_200,
      debtWithdrawalUsd: null,
    };
    const t = orderUsdTotalsFromFields(o);
    assert.equal(t.beforeCommissionUsd, 10_000);
    assert.equal(t.afterCommissionUsd, 10_200);
    assert.equal(t.codeWithdrawalUsd, 0);
  });

  it("debt withdrawal: counted only as code withdrawal, not in before/after", () => {
    const o = {
      status: OS.DEBT_WITHDRAWAL,
      amountUsd: 500,
      commissionUsd: 0,
      totalUsd: 500,
      debtWithdrawalUsd: 500,
    };
    assert.equal(orderBeforeCommissionUsd(o), 0);
    assert.equal(orderCustomerChargeUsd(o), 0);
    assert.equal(orderCustomerCreditUsd(o), 500);
  });

  it("commission + withdrawal on separate orders — no double count", () => {
    const regular = {
      status: OS.COMPLETED,
      amountUsd: 1000,
      commissionUsd: 50,
      totalUsd: 1050,
      debtWithdrawalUsd: null,
    };
    const withdrawal = {
      status: OS.DEBT_WITHDRAWAL,
      amountUsd: null,
      commissionUsd: null,
      totalUsd: 300,
      debtWithdrawalUsd: 300,
    };
    const a = orderUsdTotalsFromFields(regular);
    const b = orderUsdTotalsFromFields(withdrawal);
    assert.equal(a.beforeCommissionUsd + b.beforeCommissionUsd, 1000);
    assert.equal(a.afterCommissionUsd + b.afterCommissionUsd, 1050);
    assert.equal(a.codeWithdrawalUsd + b.codeWithdrawalUsd, 300);
  });

  it("uses totalUsd when present for after-commission", () => {
    const o = {
      status: OS.OPEN,
      amountUsd: 100,
      commissionUsd: 999,
      totalUsd: 150,
      debtWithdrawalUsd: null,
    };
    assert.equal(orderCustomerChargeUsd(o), 150);
    assert.equal(orderBeforeCommissionUsd(o), 100);
  });
});
