/**
 * Payment Intake week scope — read-only. Does not write DB or change SSOT.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { currentCustomerFinancialScope } from "@/lib/customer-financial-scope";
import {
  getPaymentIntakeEligibleOrders,
  loadPaymentIntakeBalancesForCustomer,
} from "@/lib/payment-intake-load";
import {
  ahWeekSequence,
  intakeOrderEligibleForSelectedWeek,
  sumPaymentIntakeWeekScopedRemainingUsd,
} from "@/lib/payment-intake-order-filter";

const WEEKS = ["AH-134", "AH-137", "AH-140", "AH-141", "AH-142"] as const;

function laterWeekPrefix(selected: string): string[] {
  const n = ahWeekSequence(selected);
  if (n == null) return [];
  return [`TR-${n + 1}`, `TR-${n + 2}`, `AH-${n + 1}`, `AH-${n + 2}`];
}

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

    const byWeek: Record<string, { numbers: string[]; remaining: number; has140: boolean; has141: boolean }> = {};
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
      const has141 = numbers.some((n) => n.startsWith("TR-141"));
      for (const row of loaded.orders) {
        assert.equal(
          intakeOrderEligibleForSelectedWeek({
            orderDate: row.dateYmd,
            weekCodeRaw: week,
            orderWeekCode: row.week,
          }),
          true,
          `${row.orderNumber} leaked into ${week}`,
        );
        const selectedN = ahWeekSequence(week);
        const orderN = ahWeekSequence(row.week);
        if (selectedN != null && orderN != null) {
          assert.ok(orderN <= selectedN, `${row.orderNumber} week ${row.week} > ${week}`);
        }
      }
      byWeek[week] = {
        numbers,
        remaining: loaded.weekScopedRemainingUsd,
        has140,
        has141,
      };
    }

    assert.equal(byWeek["AH-134"]?.has140, false);
    assert.equal(byWeek["AH-137"]?.has140, false);
    assert.equal(byWeek["AH-137"]?.has141, false);
    assert.equal(byWeek["AH-134"]?.remaining, 0);
    assert.equal(byWeek["AH-137"]?.remaining, 0);
    assert.ok(!(byWeek["AH-137"]?.numbers ?? []).some((n) => n.startsWith("TR-140") || n.startsWith("TR-141") || n.startsWith("TR-142")));
    assert.equal(byWeek["AH-140"]?.has140, true);
    assert.equal(byWeek["AH-140"]?.has141, false);
    assert.ok(!(byWeek["AH-140"]?.numbers ?? []).some((n) => n.startsWith("TR-141") || n.startsWith("TR-142")));
    assert.equal(byWeek["AH-140"]?.remaining, 758.01);
    assert.equal(byWeek["AH-142"]?.has140, true);
    assert.equal(byWeek["AH-142"]?.remaining, 758.01);
    assert.equal(ssot.openDebtUsd, 758.01);

    const ah137Balances = await loadPaymentIntakeBalancesForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: "AH-137",
      paymentWorkCountryRaw: "TR",
    });
    assert.equal(ah137Balances.ok, true);
    if (ah137Balances.ok) {
      assert.equal(ah137Balances.openDebtSignedUsd, 0);
    }

    const ah140Balances = await loadPaymentIntakeBalancesForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: "AH-140",
      paymentWorkCountryRaw: "TR",
    });
    assert.equal(ah140Balances.ok, true);
    if (ah140Balances.ok) {
      assert.equal(ah140Balances.openDebtSignedUsd, byWeek["AH-140"]?.remaining);
      assert.equal(ah140Balances.openDebtSignedUsd, 758.01);
    }

    const ah141Balances = await loadPaymentIntakeBalancesForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: "AH-141",
      paymentWorkCountryRaw: "TR",
    });
    assert.equal(ah141Balances.ok, true);
    if (ah141Balances.ok) {
      assert.equal(ah141Balances.openDebtSignedUsd, byWeek["AH-141"]?.remaining);
    }
  });
});

describe("payment intake week scope — all customers", () => {
  it("no future-week order may contribute to remaining / balances / cutoff", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });

    const testedWeeks = ["AH-137", "AH-140", "AH-141"] as const;
    let audited = 0;
    let leaks = 0;
    const leakDetails: string[] = [];

    for (const customer of customers) {
      audited += 1;
      for (const week of testedWeeks) {
        const loaded = await getPaymentIntakeEligibleOrders({
          customerId: customer.id,
          weekCodeForOpenBalances: week,
          paymentWorkCountryRaw: "TR",
        });
        if (!loaded.ok) {
          leaks += 1;
          leakDetails.push(`${customer.customerCode} ${week} load failed`);
          continue;
        }
        const remaining = sumPaymentIntakeWeekScopedRemainingUsd(loaded.orders);
        assert.equal(loaded.weekScopedRemainingUsd, remaining);
        for (const row of loaded.orders) {
          const selectedN = ahWeekSequence(week);
          const orderN = ahWeekSequence(row.week);
          if (selectedN != null && orderN != null && orderN > selectedN) {
            leaks += 1;
            leakDetails.push(
              `${customer.customerCode} ${week} leaked ${row.orderNumber} week=${row.week}`,
            );
          }
          for (const prefix of laterWeekPrefix(week)) {
            if ((row.orderNumber ?? "").startsWith(prefix.replace("AH-", "TR-"))) {
              leaks += 1;
              leakDetails.push(
                `${customer.customerCode} ${week} future number ${row.orderNumber}`,
              );
            }
          }
        }
        const balances = await loadPaymentIntakeBalancesForCustomer({
          customerId: customer.id,
          weekCodeForOpenBalances: week,
          paymentWorkCountryRaw: "TR",
        });
        if (!balances.ok) {
          leaks += 1;
          leakDetails.push(`${customer.customerCode} ${week} balances failed`);
          continue;
        }
        if (Math.abs(balances.openDebtSignedUsd - remaining) > 0.009) {
          leaks += 1;
          leakDetails.push(
            `${customer.customerCode} ${week} remaining=${remaining} debt=${balances.openDebtSignedUsd}`,
          );
        }
      }
    }

    assert.equal(leaks, 0, leakDetails.join(" | "));
    assert.ok(audited >= 1);
    console.log(`[week-scope] ALL CUSTOMERS AUDITED: ${audited}/${audited} FUTURE-WEEK LEAKS: ${leaks}`);
  });
});
