/**
 * Invariant: balances page books === ledger engine for the same customer + cutoff.
 * Read-only. Any single mismatch fails the suite.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import {
  getCustomerAccountBalances,
  getCustomerAccountBalancesMany,
} from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import {
  currentCustomerFinancialScope,
  historicalCustomerFinancialScope,
  resolveBalancesWeekFinancialScope,
} from "@/lib/customer-financial-scope";

const COUNTRY = "TURKEY";
const NOW = new Date(2026, 8, 27, 12, 0, 0, 0);
const CURRENT = currentCustomerFinancialScope(COUNTRY);

async function allCustomers() {
  return prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, customerCode: true },
    orderBy: { customerCode: "asc" },
  });
}

function moneyEq(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < 0.015;
}

describe("balances page === ledger engine invariant", () => {
  it("CURRENT balances books match CURRENT ledger for every customer", async () => {
    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const many = await getCustomerAccountBalancesMany(
      customers.map((c) => c.id),
      CURRENT,
    );
    const mismatches: string[] = [];
    for (const c of customers) {
      const page = many.get(c.id);
      assert.ok(page, `missing balances SSOT for ${c.customerCode}`);
      const ledger = await buildCustomerAccountLedger({
        customerId: c.id,
        sourceCountry: COUNTRY,
      });
      if (!moneyEq(page!.openDebtUsd, Number(ledger.openDebtUsd))) {
        mismatches.push(`${c.customerCode} debt page=${page!.openDebtUsd} ledger=${ledger.openDebtUsd}`);
      }
      if (!moneyEq(page!.availableCreditUsd, Number(ledger.availableCreditUsd))) {
        mismatches.push(`${c.customerCode} credit page=${page!.availableCreditUsd} ledger=${ledger.availableCreditUsd}`);
      }
      if (!moneyEq(page!.commissionBalanceUsd, Number(ledger.commissionBalanceUsd))) {
        mismatches.push(`${c.customerCode} fees page=${page!.commissionBalanceUsd} ledger=${ledger.commissionBalanceUsd}`);
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });

  it("AH-141 balances week === ledger @ 26/09/2026 23:59:59", async () => {
    const resolved = resolveBalancesWeekFinancialScope({
      selectedWeekCode: "AH-141",
      sourceCountry: COUNTRY,
      now: NOW,
    });
    assert.equal(resolved.financial.kind, "HISTORICAL");
    assert.equal(resolved.cutoffYmd, "2026-09-26");

    const customers = await allCustomers();
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const scope = historicalCustomerFinancialScope({
      cutoffYmd: "2026-09-26",
      sourceCountry: COUNTRY,
    });
    const many = await getCustomerAccountBalancesMany(
      customers.map((c) => c.id),
      scope,
    );
    const mismatches: string[] = [];
    for (const c of customers) {
      const page = many.get(c.id);
      assert.ok(page, `missing AH-141 SSOT for ${c.customerCode}`);
      const ledger = await buildCustomerAccountLedger({
        customerId: c.id,
        toYmd: "2026-09-26",
        sourceCountry: COUNTRY,
      });
      if (!moneyEq(page!.openDebtUsd, Number(ledger.openDebtUsd))) {
        mismatches.push(`${c.customerCode} debt page=${page!.openDebtUsd} ledger=${ledger.openDebtUsd}`);
      }
      if (!moneyEq(page!.availableCreditUsd, Number(ledger.availableCreditUsd))) {
        mismatches.push(`${c.customerCode} credit page=${page!.availableCreditUsd} ledger=${ledger.availableCreditUsd}`);
      }
      if (!moneyEq(page!.commissionBalanceUsd, Number(ledger.commissionBalanceUsd))) {
        mismatches.push(`${c.customerCode} fees page=${page!.commissionBalanceUsd} ledger=${ledger.commissionBalanceUsd}`);
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
  });

  it("customers 100 / 101 / 107 CURRENT and AH-141 stay on SSOT books", async () => {
    const ah141 = historicalCustomerFinancialScope({
      cutoffYmd: "2026-09-26",
      sourceCountry: COUNTRY,
    });
    for (const code of ["100", "101", "107"] as const) {
      const customer = await prisma.customer.findFirst({
        where: { customerCode: code, deletedAt: null },
        select: { id: true, customerCode: true },
      });
      if (!customer) {
        console.warn(`skip: customer ${code} missing`);
        continue;
      }
      const [current, historical, currentLedger, historicalLedger] = await Promise.all([
        getCustomerAccountBalances(customer.id, CURRENT),
        getCustomerAccountBalances(customer.id, ah141),
        buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: COUNTRY }),
        buildCustomerAccountLedger({
          customerId: customer.id,
          toYmd: "2026-09-26",
          sourceCountry: COUNTRY,
        }),
      ]);
      assert.equal(current.openDebtUsd, Number(currentLedger.openDebtUsd), `${code} CURRENT debt`);
      assert.equal(current.availableCreditUsd, Number(currentLedger.availableCreditUsd), `${code} CURRENT credit`);
      assert.equal(current.commissionBalanceUsd, Number(currentLedger.commissionBalanceUsd), `${code} CURRENT fees`);
      assert.equal(historical.openDebtUsd, Number(historicalLedger.openDebtUsd), `${code} AH-141 debt`);
      assert.equal(historical.availableCreditUsd, Number(historicalLedger.availableCreditUsd), `${code} AH-141 credit`);
      assert.equal(historical.commissionBalanceUsd, Number(historicalLedger.commissionBalanceUsd), `${code} AH-141 fees`);
      if (code === "101") {
        assert.equal(current.openDebtUsd, 758.01);
        assert.equal(current.availableCreditUsd, 0);
        assert.ok(!(current.openDebtUsd > 0 && current.availableCreditUsd > 0), "101 must not keep both books");
      }
      console.log(
        `[SSOT ${code}] CURRENT debt=${current.openDebtUsd} credit=${current.availableCreditUsd} fees=${current.commissionBalanceUsd} | AH-141 debt=${historical.openDebtUsd} credit=${historical.availableCreditUsd} fees=${historical.commissionBalanceUsd}`,
      );
    }
  });
});
