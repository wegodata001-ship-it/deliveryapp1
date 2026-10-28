/**
 * Payment intake «יתרת לקוח» card — CURRENT books, even on a historical week.
 * Historical AH-144 load does not persist Customer.balanceUsd (CURRENT-only snapshot).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances, currentCustomerFinancialScope } from "@/lib/customer-account-balances";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { sumPaymentIntakeWeekScopedRemainingUsd } from "@/lib/payment-intake-order-filter";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import { getCurrentBusinessWeek } from "@/lib/work-week";
import {
  formatIntakeCustomerBalanceHeroLine,
  formatIntakeWeekOrderDebtUsdLine,
  paymentIntakeCustomerBalanceFromCurrentBooks,
  paymentIntakeFinalBalanceCardDisplay,
} from "@/lib/payment-intake-preview";

const COUNTRY = "TURKEY";

function money(n: unknown): number {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

describe("payment intake CURRENT customer-balance card", () => {
  it("101: CURRENT +$409, AH-145/AH-144 week remaining $0", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const currentWeek = getCurrentBusinessWeek().currentBusinessWeekId;
    const defaultWeek = defaultPaymentIntakeWeekCode();
    const currentBooks = await getCustomerAccountBalances(
      customer.id,
      currentCustomerFinancialScope(COUNTRY),
    );
    assert.equal(currentBooks.scopeKind, "CURRENT");
    assert.equal(money(currentBooks.openDebtUsd), 0);
    assert.equal(money(currentBooks.availableCreditUsd), 409);
    assert.equal(money(currentBooks.netBalanceUsd), 409);
    assert.equal(money(currentBooks.commissionBalanceUsd), 1030.49);

    const [ah145, ah144] = await Promise.all([
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: "AH-145",
        paymentWorkCountryRaw: COUNTRY,
      }),
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: defaultWeek,
        paymentWorkCountryRaw: COUNTRY,
      }),
    ]);
    assert.equal(ah145.ok && ah144.ok, true);
    if (!ah145.ok || !ah144.ok) return;
    assert.equal(money(sumPaymentIntakeWeekScopedRemainingUsd(ah145.orders)), 0);
    assert.equal(money(sumPaymentIntakeWeekScopedRemainingUsd(ah144.orders)), 0);
    assert.equal(formatIntakeWeekOrderDebtUsdLine(0), "$0.00");

    const card = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: currentBooks.openDebtUsd,
        currentAvailableCreditUsd: currentBooks.availableCreditUsd,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(card.title, "יתרת לקוח");
    assert.equal(card.statusHint, "יתרת זכות ללקוח");
    assert.equal(card.balanceUsdSigned, 409);
    assert.equal(formatIntakeCustomerBalanceHeroLine({ signedBalanceUsd: 409 }), "+$409.00");
    assert.notEqual(currentWeek, defaultWeek);
  });

  it("107: CURRENT −$1,212 is not hidden by AH-144 week remaining $0", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "107", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 107 missing");
      return;
    }
    const currentBooks = await getCustomerAccountBalances(
      customer.id,
      currentCustomerFinancialScope(COUNTRY),
    );
    const defaultWeek = defaultPaymentIntakeWeekCode();
    const weekOrders = await loadPaymentIntakeOrdersForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: defaultWeek,
      paymentWorkCountryRaw: COUNTRY,
    });
    assert.equal(currentBooks.scopeKind, "CURRENT");
    assert.equal(money(currentBooks.openDebtUsd), 1212);
    assert.equal(money(currentBooks.availableCreditUsd), 0);
    assert.equal(weekOrders.ok, true);
    if (!weekOrders.ok) return;
    const weekRem = money(sumPaymentIntakeWeekScopedRemainingUsd(weekOrders.orders));
    const card = paymentIntakeCustomerBalanceFromCurrentBooks({
      currentOpenDebtUsd: currentBooks.openDebtUsd,
      currentAvailableCreditUsd: currentBooks.availableCreditUsd,
      draftPaymentUsd: 0,
    });
    assert.equal(card.signedBalanceUsd, -1212);
    assert.equal(card.statusLabel, "חוב פתוח");
    assert.notEqual(card.signedBalanceUsd, -weekRem);
  });
});
