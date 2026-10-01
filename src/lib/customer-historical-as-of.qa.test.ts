/**
 * Historical as-of / time-travel — read-only.
 * 26/09 must stay 26/09 after reading later cutoffs. CURRENT stays internally consistent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import {
  getCustomerAccountBalances,
  currentCustomerFinancialScope,
  historicalCustomerFinancialScope,
} from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import {
  loadPaymentIntakeBalancesForCustomer,
  loadPaymentIntakeOrdersForCustomer,
} from "@/lib/payment-intake-load";
import { resolvePaymentIntakeFinancialScope } from "@/lib/customer-financial-scope";

const COUNTRY = "TURKEY";
const CURRENT = currentCustomerFinancialScope(COUNTRY);
const AS_OF_26 = historicalCustomerFinancialScope({
  cutoffYmd: "2026-09-26",
  sourceCountry: COUNTRY,
});
const AS_OF_27 = historicalCustomerFinancialScope({
  cutoffYmd: "2026-09-27",
  sourceCountry: COUNTRY,
});

function money(n: unknown): number {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

function eq(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) <= 0.02;
}

async function customer101() {
  return prisma.customer.findFirst({
    where: { customerCode: "101", deletedAt: null },
    select: { id: true, customerCode: true },
  });
}

async function allCustomers() {
  return prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, customerCode: true },
    orderBy: { customerCode: "asc" },
  });
}

describe("customer historical as-of", () => {
  it("customer 101: 26/09 excludes later commission and matches later re-read", async () => {
    const customer = await customer101();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const first26 = await getCustomerAccountBalances(customer.id, AS_OF_26);
    const asOf27 = await getCustomerAccountBalances(customer.id, AS_OF_27);
    const current = await getCustomerAccountBalances(customer.id, CURRENT);
    const second26 = await getCustomerAccountBalances(customer.id, AS_OF_26);

    assert.equal(first26.scopeKind, "HISTORICAL");
    assert.equal(first26.cutoffDate, "2026-09-26");
    assert.equal(first26.openDebtUsd, 758.01);
    assert.equal(first26.availableCreditUsd, 0);
    assert.equal(first26.netBalanceUsd, -758.01);
    assert.equal(first26.commissionBalanceUsd, 177.5);

    assert.equal(asOf27.openDebtUsd, 758.01);
    assert.equal(asOf27.availableCreditUsd, 0);
    assert.equal(asOf27.commissionBalanceUsd, 177.5);

    assert.equal(current.scopeKind, "CURRENT");
    assert.equal(current.openDebtUsd, 758.01);
    assert.equal(current.availableCreditUsd, 0);
    assert.ok(current.commissionBalanceUsd >= 177.5);

    assert.equal(second26.openDebtUsd, first26.openDebtUsd);
    assert.equal(second26.availableCreditUsd, first26.availableCreditUsd);
    assert.equal(second26.netBalanceUsd, first26.netBalanceUsd);
    assert.equal(second26.commissionBalanceUsd, first26.commissionBalanceUsd);
  });

  it("101 payment intake AH-141 opening state matches SSOT 26/09, not CURRENT fees", async () => {
    const customer = await customer101();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const intakeScope = resolvePaymentIntakeFinancialScope({
      weekCode: "AH-141",
      workCountry: "TR",
      now: new Date(2026, 9, 1, 12, 0, 0, 0),
    });
    assert.equal(intakeScope.financial.kind, "HISTORICAL");
    assert.equal(intakeScope.financial.cutoffYmd, "2026-09-26");

    const [ssot, ledger, intakeBal, intakeOrders] = await Promise.all([
      getCustomerAccountBalances(customer.id, AS_OF_26),
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: "2026-09-26",
        sourceCountry: COUNTRY,
      }),
      loadPaymentIntakeBalancesForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-141",
        paymentWorkCountryRaw: "TR",
      }),
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-141",
        paymentWorkCountryRaw: "TR",
      }),
    ]);

    assert.equal(intakeBal.ok, true);
    assert.equal(intakeOrders.ok, true);
    if (!intakeBal.ok || !intakeOrders.ok) return;

    assert.equal(intakeBal.commissionBalanceUsd, 177.5);
    assert.equal(intakeBal.openDebtSignedUsd, ssot.openDebtUsd);
    assert.equal(intakeBal.creditBalanceUsd, ssot.availableCreditUsd);
    assert.equal(Number(ledger.openDebtUsd), ssot.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), ssot.availableCreditUsd);
    assert.equal(Number(ledger.commissionBalanceUsd), ssot.commissionBalanceUsd);
    assert.ok(!intakeOrders.orders.some((o) => (o.week ?? "") === "AH-142"));
    const order140 = intakeOrders.orders.find((o) => o.orderNumber === "TR-140-0001");
    assert.ok(order140);
    assert.equal(Number(order140?.commissionUsd), 68);
  });

  it("AH-137 intake does not leak TR-140-0001 or later commission", async () => {
    const customer = await customer101();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const [orders, balances] = await Promise.all([
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-137",
        paymentWorkCountryRaw: "TR",
      }),
      loadPaymentIntakeBalancesForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-137",
        paymentWorkCountryRaw: "TR",
      }),
    ]);
    assert.equal(orders.ok, true);
    assert.equal(balances.ok, true);
    if (!orders.ok || !balances.ok) return;
    assert.equal(
      orders.orders.some((o) => o.orderNumber === "TR-140-0001"),
      false,
    );
    assert.equal(
      orders.orders.some((o) => ["AH-140", "AH-141", "AH-142"].includes((o.week ?? "").trim())),
      false,
    );
    const remaining = Math.round(
      orders.orders.reduce((s, o) => s + Number(o.dbRemainingUsd ?? 0), 0) * 100,
    ) / 100;
    assert.equal(remaining, 0);
    assert.equal(balances.openDebtSignedUsd, 0);
    assert.ok(balances.commissionBalanceUsd <= 177.5);
  });

  it("CURRENT intake / ledger / SSOT stay aligned", async () => {
    const customer = await customer101();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const [ssot, ledger, intake] = await Promise.all([
      getCustomerAccountBalances(customer.id, CURRENT),
      buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: COUNTRY }),
      loadPaymentIntakeBalancesForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-142",
        paymentWorkCountryRaw: "TR",
      }),
    ]);
    assert.equal(intake.ok, true);
    if (!intake.ok) return;
    assert.ok(eq(ssot.openDebtUsd, Number(ledger.openDebtUsd)));
    assert.ok(eq(ssot.availableCreditUsd, Number(ledger.availableCreditUsd)));
    assert.ok(eq(ssot.commissionBalanceUsd, Number(ledger.commissionBalanceUsd)));
    assert.ok(eq(ssot.openDebtUsd, intake.openDebtSignedUsd));
    assert.ok(eq(ssot.availableCreditUsd, intake.creditBalanceUsd));
    assert.ok(eq(ssot.commissionBalanceUsd, intake.commissionBalanceUsd));
  });

  it("all customers: 26/09 ledger = balances = payment intake", async () => {
    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const mismatches: string[] = [];
    for (const c of customers) {
      const [ssot, ledger, intake] = await Promise.all([
        getCustomerAccountBalances(c.id, AS_OF_26),
        buildCustomerAccountLedger({
          customerId: c.id,
          toYmd: "2026-09-26",
          sourceCountry: COUNTRY,
        }),
        loadPaymentIntakeBalancesForCustomer({
          customerId: c.id,
          weekCodeForOpenBalances: "AH-141",
          paymentWorkCountryRaw: "TR",
        }),
      ]);
      if (!intake.ok) {
        mismatches.push(`${c.customerCode} intake failed`);
        continue;
      }
      if (!eq(ssot.openDebtUsd, Number(ledger.openDebtUsd)) || !eq(ssot.openDebtUsd, intake.openDebtSignedUsd)) {
        mismatches.push(
          `${c.customerCode} 26/09 debt ssot=${ssot.openDebtUsd} ledger=${ledger.openDebtUsd} intake=${intake.openDebtSignedUsd}`,
        );
      }
      if (
        !eq(ssot.availableCreditUsd, Number(ledger.availableCreditUsd)) ||
        !eq(ssot.availableCreditUsd, intake.creditBalanceUsd)
      ) {
        mismatches.push(
          `${c.customerCode} 26/09 credit ssot=${ssot.availableCreditUsd} ledger=${ledger.availableCreditUsd} intake=${intake.creditBalanceUsd}`,
        );
      }
      if (
        !eq(ssot.commissionBalanceUsd, Number(ledger.commissionBalanceUsd)) ||
        !eq(ssot.commissionBalanceUsd, intake.commissionBalanceUsd)
      ) {
        mismatches.push(
          `${c.customerCode} 26/09 fees ssot=${ssot.commissionBalanceUsd} ledger=${ledger.commissionBalanceUsd} intake=${intake.commissionBalanceUsd}`,
        );
      }
      const ledgerNet =
        Number(ledger.openDebtUsd) > 0.01
          ? -Number(ledger.openDebtUsd)
          : Number(ledger.availableCreditUsd);
      if (!eq(ssot.netBalanceUsd, ledgerNet)) {
        mismatches.push(
          `${c.customerCode} 26/09 net ssot=${ssot.netBalanceUsd} ledgerNet=${ledgerNet}`,
        );
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });

  it("all customers CURRENT ledger = balances = payment intake", async () => {
    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const mismatches: string[] = [];
    for (const c of customers) {
      const [ssot, ledger, intake] = await Promise.all([
        getCustomerAccountBalances(c.id, CURRENT),
        buildCustomerAccountLedger({ customerId: c.id, sourceCountry: COUNTRY }),
        loadPaymentIntakeBalancesForCustomer({
          customerId: c.id,
          weekCodeForOpenBalances: "AH-142",
          paymentWorkCountryRaw: "TR",
        }),
      ]);
      if (!intake.ok) {
        mismatches.push(`${c.customerCode} CURRENT intake failed`);
        continue;
      }
      if (!eq(ssot.openDebtUsd, Number(ledger.openDebtUsd)) || !eq(ssot.openDebtUsd, intake.openDebtSignedUsd)) {
        mismatches.push(
          `${c.customerCode} CURRENT debt ssot=${ssot.openDebtUsd} ledger=${ledger.openDebtUsd} intake=${intake.openDebtSignedUsd}`,
        );
      }
      if (
        !eq(ssot.availableCreditUsd, Number(ledger.availableCreditUsd)) ||
        !eq(ssot.availableCreditUsd, intake.creditBalanceUsd)
      ) {
        mismatches.push(
          `${c.customerCode} CURRENT credit ssot=${ssot.availableCreditUsd} ledger=${ledger.availableCreditUsd} intake=${intake.creditBalanceUsd}`,
        );
      }
      if (
        !eq(ssot.commissionBalanceUsd, Number(ledger.commissionBalanceUsd)) ||
        !eq(ssot.commissionBalanceUsd, intake.commissionBalanceUsd)
      ) {
        mismatches.push(
          `${c.customerCode} CURRENT fees ssot=${ssot.commissionBalanceUsd} ledger=${ledger.commissionBalanceUsd} intake=${intake.commissionBalanceUsd}`,
        );
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });
});
