/**
 * SSOT unification — אותו לקוח + אותו scope = אותם מספרים בכל הצרכנים.
 * לא כותב ל-DB.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances, getCustomerAccountBalancesMany } from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { buildCustomerCreditLedger } from "@/lib/customer-credit-balance";
import {
  currentCustomerFinancialScope,
  historicalCustomerFinancialScope,
} from "@/lib/customer-financial-scope";
import { balancesSnapshotToYmd } from "@/lib/work-week";

const COUNTRY = "TURKEY";
const CURRENT = currentCustomerFinancialScope(COUNTRY);

async function allCustomers() {
  return prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, customerCode: true },
    orderBy: { customerCode: "asc" },
  });
}

describe("customer financial SSOT unification", () => {
  it("customer 101 CURRENT books", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const [accounts, ledger, credit] = await Promise.all([
      getCustomerAccountBalances(customer.id, CURRENT),
      buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: COUNTRY }),
      buildCustomerCreditLedger(customer.id, { sourceCountry: COUNTRY }),
    ]);

    assert.equal(accounts.scopeKind, "CURRENT");
    assert.equal(accounts.cutoffDate, null);
    assert.equal(accounts.openDebtUsd, 2031.84);
    assert.equal(accounts.availableCreditUsd, 1273.83);
    assert.equal(accounts.commissionBalanceUsd, 177.5);
    assert.equal(accounts.netPositionUsd, 758.01);
    assert.equal(Number(ledger.openDebtUsd), 2031.84);
    assert.equal(Number(ledger.availableCreditUsd), 1273.83);
    assert.equal(credit.currentBalanceUsd, 1273.83);

    const cancelled = credit.movements.filter((m) => m.type === "CREDIT_CANCELLED");
    assert.ok(cancelled.length >= 1);
    assert.ok(cancelled.every((m) => m.amountUsd === 0));
    assert.ok(cancelled.every((m) => m.affectsBalance === false));
    const lastAffecting = credit.movements.find((m) => m.affectsBalance !== false);
    assert.equal(lastAffecting?.balanceAfterUsd, 1273.83);
  });

  it("customer 101 HISTORICAL 19/09 matches balances + card", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const historical = historicalCustomerFinancialScope({
      cutoffYmd: "2026-09-19",
      sourceCountry: COUNTRY,
    });
    const [accounts, ledger] = await Promise.all([
      getCustomerAccountBalances(customer.id, historical),
      buildCustomerAccountLedger({
        customerId: customer.id,
        toYmd: "2026-09-19",
        sourceCountry: COUNTRY,
      }),
    ]);

    assert.equal(accounts.scopeKind, "HISTORICAL");
    assert.equal(accounts.cutoffDate, "2026-09-19");
    assert.equal(accounts.openDebtUsd, 6868);
    assert.equal(accounts.availableCreditUsd, 1273.83);
    assert.equal(accounts.netPositionUsd, 5594.17);
    assert.equal(Number(ledger.openDebtUsd), accounts.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), accounts.availableCreditUsd);
  });

  it("all customers: payment/card/profile CURRENT debt match (batch vs single)", async () => {
    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }

    const many = await getCustomerAccountBalancesMany(
      customers.map((c) => c.id),
      CURRENT,
    );

    for (const c of customers) {
      const single = await getCustomerAccountBalances(c.id, CURRENT);
      const batched = many.get(c.id);
      assert.ok(batched, `missing batch row for ${c.customerCode}`);
      assert.equal(single.openDebtUsd, batched!.openDebtUsd, `${c.customerCode} openDebt`);
      assert.equal(single.availableCreditUsd, batched!.availableCreditUsd, `${c.customerCode} credit`);
      assert.equal(single.commissionBalanceUsd, batched!.commissionBalanceUsd, `${c.customerCode} fees`);

      const ledger = await buildCustomerAccountLedger({
        customerId: c.id,
        sourceCountry: COUNTRY,
      });
      assert.equal(Number(ledger.openDebtUsd), single.openDebtUsd, `${c.customerCode} card vs SSOT`);
      assert.equal(Number(ledger.availableCreditUsd), single.availableCreditUsd, `${c.customerCode} card credit`);
    }
  });

  it("AH-140 / AH-141 / AH-142 historical same result single vs many", async () => {
    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const ids = customers.map((c) => c.id);

    for (const week of ["AH-140", "AH-141", "AH-142"] as const) {
      const cutoffYmd = balancesSnapshotToYmd(week);
      const scope = historicalCustomerFinancialScope({
        cutoffYmd,
        sourceCountry: COUNTRY,
      });
      const many = await getCustomerAccountBalancesMany(ids, scope);
      for (const c of customers) {
        const single = await getCustomerAccountBalances(c.id, scope);
        const batched = many.get(c.id);
        assert.ok(batched);
        assert.equal(single.openDebtUsd, batched!.openDebtUsd, `${c.customerCode} ${week} debt`);
        assert.equal(single.availableCreditUsd, batched!.availableCreditUsd, `${c.customerCode} ${week} credit`);
      }
    }
  });
});
