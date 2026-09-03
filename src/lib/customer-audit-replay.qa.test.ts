/**
 * Live regression — שלושת ה-FAIL של ה-master audit.
 * מדלג אם הלקוח לא ב-DB.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { buildCustomerCommissionLedger } from "@/lib/customer-commission-ledger";
import { sumActiveCommissionMovementUsd } from "@/lib/customer-commission-movements";

async function loadCustomer(code: string) {
  return prisma.customer.findFirst({
    where: { customerCode: code, deletedAt: null },
    select: { id: true, displayName: true },
  });
}

describe("master audit replay — 102 / 105 / 106", () => {
  it("עומר #102 — running $0 ופירוט עמלות $62.50", async () => {
    const customer = await loadCustomer("102");
    if (!customer) {
      console.warn("skip: customer 102 not in this database");
      return;
    }
    const [ssot, ledger, fees] = await Promise.all([
      getCustomerAccountBalances(customer.id),
      buildCustomerAccountLedger({ customerId: customer.id }),
      buildCustomerCommissionLedger(customer.id),
    ]);
    assert.equal(ssot.openDebtUsd, 0);
    assert.equal(ssot.availableCreditUsd, 0);
    assert.equal(ssot.commissionBalanceUsd, 62.5);
    assert.equal(Number(ledger.rows.at(-1)?.balanceUsd), 0);
    assert.ok(ledger.rows.every((r) => Number(r.balanceUsd) >= -0.001 || !r.isDebtWithdrawal));
    assert.equal(fees.currentBalanceUsd, 62.5);
    assert.equal(sumActiveCommissionMovementUsd(fees.movements), 62.5);
    assert.equal(fees.movements.at(-1)?.balanceAfterUsd, 62.5);
  });

  it("כאמל #105 — פירוט עמלות $124.62", async () => {
    const customer = await loadCustomer("105");
    if (!customer) {
      console.warn("skip: customer 105 not in this database");
      return;
    }
    const [ssot, fees] = await Promise.all([
      getCustomerAccountBalances(customer.id),
      buildCustomerCommissionLedger(customer.id),
    ]);
    assert.equal(ssot.openDebtUsd, 0);
    assert.equal(ssot.commissionBalanceUsd, 124.62);
    assert.equal(fees.currentBalanceUsd, 124.62);
    assert.equal(sumActiveCommissionMovementUsd(fees.movements), 124.62);
    assert.equal(fees.movements.at(-1)?.balanceAfterUsd, 124.62);
  });

  it("אימאן #106 — running $0.33 בלי כפל איפוס", async () => {
    const customer = await loadCustomer("106");
    if (!customer) {
      console.warn("skip: customer 106 not in this database");
      return;
    }
    const [ssot, ledger, fees] = await Promise.all([
      getCustomerAccountBalances(customer.id),
      buildCustomerAccountLedger({ customerId: customer.id }),
      buildCustomerCommissionLedger(customer.id),
    ]);
    assert.equal(ssot.openDebtUsd, 0.33);
    assert.equal(ssot.commissionBalanceUsd, 86.01);
    assert.equal(Number(ledger.rows.at(-1)?.balanceUsd), 0.33);
    const resetRows = ledger.rows.filter((r) => r.isBalanceReset || r.isCommissionDebtClosure);
    const resetOps = new Set(resetRows.map((r) => r.dateYmd + r.document));
    assert.ok(resetOps.size <= 3, "grouped resets should not emit 9 money rows");
    assert.equal(fees.currentBalanceUsd, 86.01);
  });
});
