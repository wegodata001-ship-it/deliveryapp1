import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  planBalanceResetToZero,
  planBalanceResetToZeroFromNumbers,
} from "@/lib/commission-debt-closure";

describe("planBalanceResetToZero", () => {
  it("closes underpayment by reducing commission and total to paid", () => {
    const plan = planBalanceResetToZero({
      commissionUsd: new Prisma.Decimal("100"),
      totalUsd: new Prisma.Decimal("7000"),
      paidUsd: new Prisma.Decimal("6998"),
    });
    assert.equal(plan.afterTotalUsd.toString(), "6998");
    assert.equal(plan.afterCommissionUsd.toString(), "98");
    assert.equal(plan.remainingUsd.toString(), "2");
  });

  it("closes overpayment by increasing commission and total to paid", () => {
    const plan = planBalanceResetToZero({
      commissionUsd: new Prisma.Decimal("100"),
      totalUsd: new Prisma.Decimal("7000"),
      paidUsd: new Prisma.Decimal("7002"),
    });
    assert.equal(plan.afterTotalUsd.toString(), "7002");
    assert.equal(plan.afterCommissionUsd.toString(), "102");
    assert.equal(plan.remainingUsd.toString(), "-2");
  });

  it("leaves balanced orders unchanged", () => {
    const plan = planBalanceResetToZero({
      commissionUsd: new Prisma.Decimal("100"),
      totalUsd: new Prisma.Decimal("7000"),
      paidUsd: new Prisma.Decimal("7000"),
    });
    assert.equal(plan.afterTotalUsd.toString(), "7000");
    assert.equal(plan.afterCommissionUsd.toString(), "100");
  });
});

describe("planBalanceResetToZeroFromNumbers", () => {
  it("matches decimal planner for underpayment", () => {
    const plan = planBalanceResetToZeroFromNumbers({
      commissionUsd: 100,
      totalUsd: 7000,
      paidUsd: 6998,
    });
    assert.equal(plan.afterTotalUsd, 6998);
    assert.equal(plan.afterCommissionUsd, 98);
  });

  it("matches decimal planner for overpayment", () => {
    const plan = planBalanceResetToZeroFromNumbers({
      commissionUsd: 100,
      totalUsd: 7000,
      paidUsd: 7002,
    });
    assert.equal(plan.afterTotalUsd, 7002);
    assert.equal(plan.afterCommissionUsd, 102);
  });
});
