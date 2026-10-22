/**
 * Read-only: proves 101 auto-adjust persist never updates a missing breakdown id.
 * Does not save a payment or mutate financial data.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getPaymentIntakeEligibleOrders } from "@/lib/payment-intake-load";
import { planPaymentIntentAdjustments } from "@/lib/payment-method-payment-intent";
import {
  isPersistedBreakdownId,
  resolveBreakdownPaidPersistTarget,
} from "@/lib/order-breakdown-paid-persist";

describe("customer 101 — auto-adjust persist without stale breakdown update", () => {
  it("synthetic or rewritten ids resolve against live DB keys, not Prisma update-by-missing-id", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101" },
      select: { id: true },
    });
    if (!customer) return;

    const loaded = await getPaymentIntakeEligibleOrders({
      customerId: customer.id,
      weekCodeForOpenBalances: "AH-141",
      paymentWorkCountryRaw: "TR",
    });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.weekScopedRemainingUsd, 758.01);

    const plan = planPaymentIntentAdjustments({
      orders: loaded.orders,
      intents: [{ method: "CASH", currency: "USD", amountNative: 800 }],
      exchangeRate: 3.3,
      customerOpenDebtUsd: loaded.weekScopedRemainingUsd,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.openDebtUsd, 758.01);
    assert.equal(plan.totalPayUsd, 800);
    assert.equal(plan.closesDebtUsd, 758.01);
    assert.equal(plan.overpaymentUsd, 41.99);

    const orderIds = [
      ...new Set([
        ...loaded.orders.map((row) => row.id),
        ...plan.orderChanges.map((row) => row.orderId),
      ]),
    ];
    const existing = await prisma.orderPaymentBreakdown.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, orderId: true, paymentMethod: true, currency: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));

    const used = new Set<string>();
    let prismaRecordNotFoundRisk = 0;
    for (const change of plan.orderChanges) {
      for (const line of change.afterBreakdown) {
        const syntheticId = `auto-adjust:${change.orderId}:${line.paymentMethod}:${line.currency}`;
        assert.equal(isPersistedBreakdownId(syntheticId), false);
        const target = resolveBreakdownPaidPersistTarget(
          existing,
          {
            breakdownId: syntheticId,
            orderId: change.orderId,
            method: line.paymentMethod,
            currency: line.currency,
            planned: Number(line.amount) || 0,
            paid: Number(line.amount) || 0,
            remaining: 0,
          },
          used,
        );
        if (target.action === "update") {
          used.add(target.id);
          if (!existingIds.has(target.id)) prismaRecordNotFoundRisk += 1;
        }
      }
    }
    assert.equal(prismaRecordNotFoundRisk, 0);
  });
});
