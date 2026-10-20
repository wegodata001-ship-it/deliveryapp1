/**
 * Payment intake «יתרת לקוח» card — CURRENT books, even on a historical week.
 * Historical AH-144 load does not persist Customer.balanceUsd (CURRENT-only snapshot).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances, currentCustomerFinancialScope } from "@/lib/customer-account-balances";
import { loadPaymentIntakeBalancesForCustomer } from "@/lib/payment-intake-load";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import { getCurrentBusinessWeek } from "@/lib/work-week";
import {
  formatIntakeCustomerBalanceHeroLine,
  paymentIntakeCustomerBalanceFromCurrentBooks,
  paymentIntakeFinalBalanceCardDisplay,
} from "@/lib/payment-intake-preview";

const COUNTRY = "TURKEY";
const EPS = 0.01;

function money(n: unknown): number {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

describe("payment intake CURRENT customer-balance card — customer 101", () => {
  it("AH-144 week remaining $0 still loads CURRENT +$510 for the card", async () => {
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
    assert.notEqual(defaultWeek, currentWeek);

    const currentBooks = await getCustomerAccountBalances(
      customer.id,
      currentCustomerFinancialScope(COUNTRY),
    );
    assert.equal(currentBooks.scopeKind, "CURRENT");
    assert.equal(money(currentBooks.openDebtUsd), 0);
    assert.equal(money(currentBooks.availableCreditUsd), 510);
    assert.equal(money(currentBooks.netBalanceUsd), 510);

    const historicalLoad = await loadPaymentIntakeBalancesForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: defaultWeek,
      paymentWorkCountryRaw: COUNTRY,
    });
    assert.equal(historicalLoad.ok, true);
    if (!historicalLoad.ok) return;

    assert.equal(money(historicalLoad.currentOpenDebtUsd), 0);
    assert.equal(money(historicalLoad.currentAvailableCreditUsd), 510);
    assert.equal(money(historicalLoad.currentNetBalanceUsd), 510);
    assert.equal(money(historicalLoad.openDebtSignedUsd), 0);
    assert.notEqual(money(historicalLoad.creditBalanceUsd), 0);
    assert.ok(money(historicalLoad.creditBalanceUsd) >= 510);

    const card = paymentIntakeFinalBalanceCardDisplay(
      paymentIntakeCustomerBalanceFromCurrentBooks({
        currentOpenDebtUsd: historicalLoad.currentOpenDebtUsd,
        currentAvailableCreditUsd: historicalLoad.currentAvailableCreditUsd,
        draftPaymentUsd: 0,
      }),
      3,
    );
    assert.equal(card.title, "יתרת לקוח");
    assert.equal(card.statusHint, "יתרת זכות");
    assert.equal(card.balanceUsdSigned, 510);
    assert.equal(
      formatIntakeCustomerBalanceHeroLine({
        signedBalanceUsd: card.balanceUsdSigned,
        surplusPendingUsd: card.surplusPendingUsd,
      }),
      "+$510.00",
    );
  });
});
