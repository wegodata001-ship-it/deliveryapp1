import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { planCommissionSurplusAbsorption } from "@/lib/commission-debt-closure";
import {
  isLargePaymentOverageUsd,
  isSmallPaymentOverageUsd,
  PAYMENT_SMALL_OVERAGE_TOLERANCE_USD,
} from "@/lib/payment-small-overage";

describe("payment small overage tolerance", () => {
  it("treats up to $5 surplus as small", () => {
    assert.equal(isSmallPaymentOverageUsd(0.03), true);
    assert.equal(isSmallPaymentOverageUsd(5), true);
    assert.equal(isSmallPaymentOverageUsd(5.02), true);
    assert.equal(isSmallPaymentOverageUsd(0.01), false);
    assert.equal(isLargePaymentOverageUsd(5.03), true);
    assert.equal(PAYMENT_SMALL_OVERAGE_TOLERANCE_USD, 5);
  });
});

describe("planCommissionSurplusAbsorption", () => {
  it("adds surplus to commission and total", () => {
    const plan = planCommissionSurplusAbsorption({
      commissionUsd: new Prisma.Decimal("0.02"),
      totalUsd: new Prisma.Decimal("700.02"),
      surplusUsd: new Prisma.Decimal("0.03"),
    });
    assert.equal(plan.afterCommissionUsd.toString(), "0.05");
    assert.equal(plan.afterTotalUsd.toString(), "700.05");
  });
});
