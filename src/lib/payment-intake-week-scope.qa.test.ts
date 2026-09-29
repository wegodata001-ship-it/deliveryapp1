/**
 * Payment Intake week scope — read-only. Does not write DB or change SSOT.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { currentCustomerFinancialScope } from "@/lib/customer-financial-scope";
import { getPaymentIntakeEligibleOrders } from "@/lib/payment-intake-load";
import { intakeOrderEligibleForSelectedWeek } from "@/lib/payment-intake-order-filter";

const WEEKS = ["AH-134", "AH-137", "AH-140", "AH-142"] as const;

describe("payment intake week scope — customer 101", () => {
  it("CURRENT SSOT stays $758.01 while week remaining follows eligible orders", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101" },
      select: { id: true },
    });
    if (!customer) return;

    const ssot = await getCustomerAccountBalances(
      customer.id,
      currentCustomerFinancialScope("TURKEY"),
    );
    assert.equal(ssot.openDebtUsd, 758.01);
    assert.equal(ssot.availableCreditUsd, 0);

    const byWeek: Record<string, { numbers: string[]; remaining: number; has140: boolean }> = {};
    for (const week of WEEKS) {
      const loaded = await getPaymentIntakeEligibleOrders({
        customerId: customer.id,
        weekCodeForOpenBalances: week,
        paymentWorkCountryRaw: "TR",
      });
      assert.equal(loaded.ok, true);
      if (!loaded.ok) continue;
      const numbers = loaded.orders.map((o) => o.orderNumber ?? "");
      const has140 = numbers.includes("TR-140-0001");
      for (const row of loaded.orders) {
        assert.equal(
          intakeOrderEligibleForSelectedWeek({
            orderDate: row.dateYmd,
            weekCodeRaw: week,
          }),
          true,
          `${row.orderNumber} leaked into ${week}`,
        );
      }
      byWeek[week] = {
        numbers,
        remaining: loaded.weekScopedRemainingUsd,
        has140,
      };
    }

    assert.equal(byWeek["AH-134"]?.has140, false);
    assert.equal(byWeek["AH-137"]?.has140, false);
    assert.equal(byWeek["AH-134"]?.remaining, 0);
    assert.equal(byWeek["AH-137"]?.remaining, 0);
    assert.equal(byWeek["AH-140"]?.has140, true);
    assert.equal(byWeek["AH-140"]?.remaining, 758.01);
    assert.equal(byWeek["AH-142"]?.has140, true);
    assert.equal(byWeek["AH-142"]?.remaining, 758.01);
    assert.equal(ssot.openDebtUsd, 758.01);
  });
});
