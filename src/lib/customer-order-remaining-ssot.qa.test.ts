/**
 * Regression — SUM(effective order remaining) === accounts.openDebtUsd
 * לכל הלקוחות הפעילים. בלי כתיבות.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalancesMany } from "@/lib/customer-account-balances";
import { currentCustomerFinancialScopeForWorkCountry } from "@/lib/customer-financial-scope";
import { loadCollectibleRemainingUsdByOrderId } from "@/lib/orders-list-collectible-remaining";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { virtualCustomerCreditAppliedUsdByOrderId } from "@/lib/order-remaining-debt";
import { calculateCustomerBalances } from "@/lib/customer-balance-calculator";
import { getCustomerCreditBalancesUsdMany } from "@/lib/customer-credit-balance";
import { computeOrderOpenDebtUsd, resolveOrderTotalUsd } from "@/lib/order-remaining-debt";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
import { customerDebtPaymentsWhere } from "@/lib/payment-adjustment-fee";
import { groupByActivePayments } from "@/lib/payment-record-status";

const EPS = 0.01;

function r2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

describe("order remaining reconciles with customer SSOT", () => {
  it("all active customers: SUM(collectible remaining) === openDebtUsd", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });
    const ids = customers.map((c) => c.id);
    const scope = currentCustomerFinancialScopeForWorkCountry("TR");
    const [accounts, collectible] = await Promise.all([
      getCustomerAccountBalancesMany(ids, scope),
      loadCollectibleRemainingUsdByOrderId(ids),
    ]);

    const orders = await prisma.order.findMany({
      where: { customerId: { in: ids }, deletedAt: null, status: { not: OS.CANCELLED } },
      select: { id: true, customerId: true, status: true },
    });
    const remainingByCustomer = new Map<string, number>();
    for (const o of orders) {
      if (!o.customerId || isDebtWithdrawalOrderStatus(o.status)) continue;
      remainingByCustomer.set(
        o.customerId,
        r2((remainingByCustomer.get(o.customerId) ?? 0) + (collectible.get(o.id) ?? 0)),
      );
    }

    const mismatches: string[] = [];
    for (const c of customers) {
      const open = r2(accounts.get(c.id)?.openDebtUsd ?? 0);
      const orderSum = remainingByCustomer.get(c.id) ?? 0;
      if (Math.abs(open - orderSum) > EPS) {
        mismatches.push(`${c.customerCode}: ssot ${open} vs orders ${orderSum}`);
      }
    }
    assert.deepEqual(mismatches, []);
    assert.equal(customers.length, 12);
  });

  it("all four views: Ledger / Balances / Payment Intake / Order Remaining", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });
    const ids = customers.map((c) => c.id);
    const scope = currentCustomerFinancialScopeForWorkCountry("TR");
    const [accounts, collectible] = await Promise.all([
      getCustomerAccountBalancesMany(ids, scope),
      loadCollectibleRemainingUsdByOrderId(ids),
    ]);
    const orders = await prisma.order.findMany({
      where: { customerId: { in: ids }, deletedAt: null, status: { not: OS.CANCELLED } },
      select: { id: true, customerId: true, status: true },
    });
    const remainingByCustomer = new Map<string, number>();
    for (const o of orders) {
      if (!o.customerId || isDebtWithdrawalOrderStatus(o.status)) continue;
      remainingByCustomer.set(
        o.customerId,
        r2((remainingByCustomer.get(o.customerId) ?? 0) + (collectible.get(o.id) ?? 0)),
      );
    }

    const expected: Record<string, number> = { "101": 758.01, "102": 0, "105": 0 };
    const mismatches: string[] = [];
    let ledgerPass = 0;
    let balancesPass = 0;
    let intakePass = 0;
    let remainingPass = 0;
    let allFour = 0;

    for (const c of customers) {
      const balances = r2(accounts.get(c.id)?.openDebtUsd ?? 0);
      const ledger = await buildCustomerAccountLedger({
        customerId: c.id,
        sourceCountry: "TURKEY",
      });
      const ledgerDebt = r2(Number(ledger.openDebtUsd));
      const intake = await loadPaymentIntakeOrdersForCustomer({
        customerId: c.id,
        paymentWorkCountryRaw: "TURKEY",
      });
      const intakeSum = intake.ok
        ? r2(intake.orders.reduce((s, o) => s + Number(o.dbRemainingUsd), 0))
        : NaN;
      const orderSum = remainingByCustomer.get(c.id) ?? 0;

      const ledgerOk = Math.abs(ledgerDebt - balances) <= EPS;
      const balancesOk = true;
      const intakeOk = Math.abs(intakeSum - balances) <= EPS;
      const remainingOk = Math.abs(orderSum - balances) <= EPS;
      if (ledgerOk) ledgerPass += 1;
      else mismatches.push(`${c.customerCode} ledger ${ledgerDebt} vs balances ${balances}`);
      if (balancesOk) balancesPass += 1;
      if (intakeOk) intakePass += 1;
      else mismatches.push(`${c.customerCode} intake ${intakeSum} vs balances ${balances}`);
      if (remainingOk) remainingPass += 1;
      else mismatches.push(`${c.customerCode} remaining ${orderSum} vs balances ${balances}`);
      if (ledgerOk && intakeOk && remainingOk) allFour += 1;

      const exp = expected[c.customerCode ?? ""];
      if (exp != null && Math.abs(balances - exp) > EPS) {
        mismatches.push(`${c.customerCode} expected ${exp} got ${balances}`);
      }
    }

    assert.deepEqual(mismatches, []);
    assert.equal(ledgerPass, 12);
    assert.equal(balancesPass, 12);
    assert.equal(intakePass, 12);
    assert.equal(remainingPass, 12);
    assert.equal(allFour, 12);
  });

  it("customer 101 virtual credit FIFO and intake remaining", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 not in this database");
      return;
    }
    const scope = currentCustomerFinancialScopeForWorkCountry("TR");
    const [accounts, intake, balances, credits] = await Promise.all([
      getCustomerAccountBalancesMany([customer.id], scope),
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        paymentWorkCountryRaw: "TURKEY",
      }),
      calculateCustomerBalances([customer.id]),
      getCustomerCreditBalancesUsdMany([customer.id]),
    ]);
    assert.equal(intake.ok, true);
    if (!intake.ok) return;
    const ssot = r2(accounts.get(customer.id)?.openDebtUsd ?? 0);
    const intakeSum = r2(intake.orders.reduce((s, o) => s + Number(o.dbRemainingUsd), 0));
    assert.equal(ssot, 758.01);
    assert.equal(intakeSum, 758.01);

    const orders = await prisma.order.findMany({
      where: {
        customerId: customer.id,
        deletedAt: null,
        status: { not: OS.CANCELLED },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        orderDate: true,
        createdAt: true,
      },
    });
    const regular = orders
      .filter((o) => !isDebtWithdrawalOrderStatus(o.status))
      .sort((a, b) => {
        const ta = (a.orderDate ?? a.createdAt ?? new Date(0)).getTime();
        const tb = (b.orderDate ?? b.createdAt ?? new Date(0)).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      });
    const paidSums = await groupByActivePayments(
      "orderId",
      { orderId: { in: regular.map((o) => o.id) }, ...customerDebtPaymentsWhere },
      { amountUsd: true },
    );
    const paidByOrder = new Map<string, number>();
    for (const row of paidSums) {
      if (row.orderId) paidByOrder.set(row.orderId, Number(row._sum.amountUsd ?? 0));
    }
    const rows = regular.map((o) => ({
      orderId: o.id,
      remainingAfterPaymentsUsd: computeOrderOpenDebtUsd(
        resolveOrderTotalUsd(o),
        paidByOrder.get(o.id) ?? 0,
      ),
    }));
    const applied = virtualCustomerCreditAppliedUsdByOrderId(
      rows,
      Number(balances.get(customer.id)?.totalWithdrawals ?? 0),
      credits.get(customer.id) ?? 0,
    );
    const appliedTotal = r2([...applied.values()].reduce((s, n) => s + n, 0));
    assert.equal(appliedTotal, 1273.83);
    console.info(
      "[101 virtual credit FIFO]",
      regular
        .filter((o) => (applied.get(o.id) ?? 0) > 0.001)
        .map((o) => ({
          order: o.orderNumber,
          creditUsd: applied.get(o.id),
        })),
    );
  });
});
