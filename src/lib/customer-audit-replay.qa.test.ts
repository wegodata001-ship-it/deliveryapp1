/**
 * בדיקת קריאה: כרטסת, יתרה ופירוט עמלות של אותו לקוח חייבים להסכים.
 * סכומי Production קפואים נמצאים בסקריפט הביקורת, לא כאן.
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
  it("עומר #102 — כרטסת, יתרה ופירוט עמלות מסכימים", async () => {
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
    assert.equal(Number(ledger.rows.at(-1)?.balanceUsd), ssot.openDebtUsd);
    assert.ok(ledger.rows.every((r) => Number(r.balanceUsd) >= -0.001 || !r.isDebtWithdrawal));
    assert.equal(fees.currentBalanceUsd, ssot.commissionBalanceUsd);
    assert.equal(sumActiveCommissionMovementUsd(fees.movements), ssot.commissionBalanceUsd);
    assert.equal(fees.movements.at(-1)?.balanceAfterUsd, ssot.commissionBalanceUsd);
  });

  it("כאמל #105 — פירוט עמלות מסכים ליתרה", async () => {
    const customer = await loadCustomer("105");
    if (!customer) {
      console.warn("skip: customer 105 not in this database");
      return;
    }
    const [ssot, fees] = await Promise.all([
      getCustomerAccountBalances(customer.id),
      buildCustomerCommissionLedger(customer.id),
    ]);
    assert.equal(fees.currentBalanceUsd, ssot.commissionBalanceUsd);
    assert.equal(sumActiveCommissionMovementUsd(fees.movements), ssot.commissionBalanceUsd);
    assert.equal(fees.movements.at(-1)?.balanceAfterUsd, ssot.commissionBalanceUsd);
  });

  it("אימאן #106 — יתרה מסוכמת בלי כפל איפוס", async () => {
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
    assert.equal(Number(ledger.openDebtUsd), ssot.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), ssot.availableCreditUsd);
    assert.equal(Number(ledger.balanceUsd), Number((ssot.openDebtUsd - ssot.availableCreditUsd).toFixed(2)));
    assert.equal(fees.currentBalanceUsd, ssot.commissionBalanceUsd);
    const resetRows = ledger.rows.filter((r) => r.isBalanceReset || r.isCommissionDebtClosure);
    const resetOps = new Set(resetRows.map((r) => r.dateYmd + r.document));
    assert.ok(resetOps.size <= 3, "grouped resets should not emit 9 money rows");
  });
});
