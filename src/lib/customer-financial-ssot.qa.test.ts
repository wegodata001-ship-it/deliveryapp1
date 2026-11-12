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
    assert.equal(accounts.openDebtUsd, Number(ledger.openDebtUsd));
    assert.equal(accounts.availableCreditUsd, Number(ledger.availableCreditUsd));

    const cancelled = credit.movements.filter((m) => m.type === "CREDIT_CANCELLED");
    assert.ok(cancelled.length >= 1);
    assert.ok(cancelled.every((m) => m.amountUsd === 0));
    assert.ok(cancelled.every((m) => m.affectsBalance === false));
    const affecting = credit.movements.filter((m) => m.affectsBalance !== false);
    assert.ok(affecting.some((m) => m.balanceAfterUsd === credit.currentBalanceUsd));
  });

  it("customers 107 / 100 keep debt and credit exclusive", async () => {
    for (const code of ["107", "100"] as const) {
      const customer = await prisma.customer.findFirst({
        where: { customerCode: code, deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        console.warn(`skip: customer ${code} missing`);
        continue;
      }
      const accounts = await getCustomerAccountBalances(customer.id, CURRENT);
      if (accounts.openDebtUsd > 0) assert.equal(accounts.availableCreditUsd, 0, `${code} credit`);
      if (accounts.availableCreditUsd > 0) assert.equal(accounts.openDebtUsd, 0, `${code} debt`);
      assert.equal(accounts.netBalanceUsd, Number((accounts.availableCreditUsd - accounts.openDebtUsd).toFixed(2)));
    }
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
    assert.equal(Number(ledger.openDebtUsd), accounts.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), accounts.availableCreditUsd);
    assert.equal(accounts.netBalanceUsd, Number((accounts.availableCreditUsd - accounts.openDebtUsd).toFixed(2)));
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
      if (!cutoffYmd) continue;
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
