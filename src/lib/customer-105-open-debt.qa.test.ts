/**
 * Regression — כאמל #105.
 * כרטיס «חוב פתוח» ויתרות הזמנה חייבים להסתכם לאותו SSOT.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { getCustomerOpenDebt, openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";

describe("customer 105 intake open debt SSOT", () => {
  it("card, ledger SSOT and collectible intake remaining all match", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "105", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 105 not in this database");
      return;
    }

    const scope = openDebtScopeForWorkCountry("TURKEY");
    const [accounts, debt, intake] = await Promise.all([
      getCustomerAccountBalances(customer.id, scope),
      getCustomerOpenDebt(customer.id, scope),
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-139",
        paymentWorkCountryRaw: "TURKEY",
      }),
    ]);
    assert.equal(intake.ok, true);
    if (!intake.ok) return;

    const intakeRemaining = Math.round(
      intake.orders.reduce((s, o) => s + Number(o.dbRemainingUsd), 0) * 100,
    ) / 100;

    assert.equal(accounts.openDebtUsd, Number(debt.openDebtUsd));
    assert.equal(intakeRemaining, Number(debt.openDebtUsd));
    assert.equal(Number(debt.totalWithdrawalsUsd), 1212);
    assert.equal(Number(debt.signedBalanceUsd), 0);
  });
});
