/**
 * Customer Khalil / 101 — three-screen financial consistency.
 * READ-ONLY. Does not call loadPaymentIntakeBalancesForCustomer (can persist).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import {
  getCustomerAccountBalances,
  currentCustomerFinancialScope,
  normalizeExclusiveCustomerBooks,
} from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { sumPaymentIntakeWeekScopedRemainingUsd } from "@/lib/payment-intake-order-filter";
import { availableCreditForWeekScopedPayable } from "@/lib/payment-intake-preview";
import { resolvePaymentIntakeFinancialScope } from "@/lib/customer-financial-scope";
import { defaultPaymentIntakeWeekCode } from "@/lib/payment-intake-default-week";
import { getCurrentBusinessWeek } from "@/lib/work-week";
import { calculateCustomerBalance } from "@/lib/customer-balance-calculator";
import {
  collectibleRemainingUsdByOrderId,
  resolveOrderTotalUsd,
  computeOrderOpenDebtUsd,
} from "@/lib/order-remaining-debt";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
import { paymentRecordUsdEquivalent } from "@/lib/payment-usd-equivalent";
import { isCustomerDebtExcludedPayment } from "@/lib/payment-adjustment-fee";
import { getCustomerCreditBalanceUsd } from "@/lib/customer-credit-balance";
import { getCustomerCommissionBalanceUsd } from "@/lib/customer-commission-balance";

const COUNTRY = "TURKEY";
const EPS = 0.01;

function money(n: unknown): number {
  return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

function eq(a: unknown, b: unknown): boolean {
  return Math.abs(money(a) - money(b)) <= EPS;
}

async function khalil() {
  return prisma.customer.findFirst({
    where: { customerCode: "101", deletedAt: null },
    select: { id: true, customerCode: true, displayName: true },
  });
}

describe("Khalil / customer 101 three-screen audit", () => {
  it("identifies a single live customer named חליל as code 101", async () => {
    const matches = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { displayName: { contains: "חליל" } },
          { nameAr: { contains: "חליל" } },
          { displayName: { contains: "khalil", mode: "insensitive" } },
        ],
      },
      select: { id: true, customerCode: true, displayName: true },
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.customerCode, "101");
    assert.equal(matches[0]?.displayName, "חליל");
  });

  it("independent exclusive books match CURRENT card and balances", async () => {
    const customer = await khalil();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const scope = currentCustomerFinancialScope(COUNTRY);
    const [orders, payments, accounts, ledger, grossCredit, commission] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: customer.id, deletedAt: null },
        select: {
          id: true,
          status: true,
          totalUsd: true,
          amountUsd: true,
          commissionUsd: true,
          debtWithdrawalUsd: true,
        },
      }),
      prisma.payment.findMany({
        where: { customerId: customer.id },
        select: {
          orderId: true,
          status: true,
          isPaid: true,
          businessType: true,
          amountUsd: true,
          amountIls: true,
          exchangeRate: true,
        },
      }),
      getCustomerAccountBalances(customer.id, scope),
      buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: COUNTRY }),
      getCustomerCreditBalanceUsd(customer.id, { sourceCountry: COUNTRY }),
      getCustomerCommissionBalanceUsd(customer.id, { sourceCountry: COUNTRY }),
    ]);

    const chargeable = orders.filter(
      (o) => o.status !== OS.CANCELLED && !isDebtWithdrawalOrderStatus(o.status),
    );
    const withdrawals = orders.filter((o) => isDebtWithdrawalOrderStatus(o.status));
    const activePays = payments.filter((p) => p.status !== "CANCELLED" && (p.status === "ACTIVE" || p.isPaid));
    const debtPays = activePays.filter((p) => !isCustomerDebtExcludedPayment(p.businessType));
    const paidByOrder = new Map<string, number>();
    for (const p of debtPays) {
      if (!p.orderId) continue;
      const usd = money(paymentRecordUsdEquivalent(p));
      paidByOrder.set(p.orderId, money((paidByOrder.get(p.orderId) ?? 0) + usd));
    }
    const remainders = chargeable.map((o) => {
      const total = resolveOrderTotalUsd(o);
      const paid = paidByOrder.get(o.id) ?? 0;
      return { orderId: o.id, remainingAfterPaymentsUsd: computeOrderOpenDebtUsd(total, paid) };
    });
    const withdrawalUsd = money(
      withdrawals.reduce((s, o) => {
        const w = Number(o.debtWithdrawalUsd);
        return s + (Number.isFinite(w) && w > 0 ? w : resolveOrderTotalUsd(o));
      }, 0),
    );
    const remainingAfterPayments = money(
      remainders.reduce((s, r) => s + r.remainingAfterPaymentsUsd, 0),
    );
    const fifo = collectibleRemainingUsdByOrderId(remainders, withdrawalUsd, money(grossCredit));
    const fifoOpen = money([...fifo.values()].reduce((s, n) => s + money(n), 0));
    const exclusive = normalizeExclusiveCustomerBooks({
      openDebtUsd: fifoOpen,
      availableCreditUsd: money(grossCredit),
    });

    assert.ok(eq(fifoOpen, money(Math.max(0, remainingAfterPayments - withdrawalUsd))));
    assert.ok(eq(exclusive.openDebtUsd, accounts.openDebtUsd));
    assert.ok(eq(exclusive.availableCreditUsd, accounts.availableCreditUsd));
    assert.ok(eq(exclusive.netBalanceUsd, accounts.netBalanceUsd));
    assert.ok(eq(accounts.openDebtUsd, Number(ledger.openDebtUsd)));
    assert.ok(eq(accounts.availableCreditUsd, Number(ledger.availableCreditUsd)));
    assert.ok(eq(accounts.commissionBalanceUsd, Number(ledger.commissionBalanceUsd)));
    assert.ok(eq(accounts.commissionBalanceUsd, commission));
    assert.ok(!(accounts.openDebtUsd > EPS && accounts.availableCreditUsd > EPS));
  });

  it("CURRENT business week intake remaining matches CURRENT SSOT", async () => {
    const customer = await khalil();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const week = getCurrentBusinessWeek().currentBusinessWeekId;
    const scope = currentCustomerFinancialScope(COUNTRY);
    const [accounts, intake] = await Promise.all([
      getCustomerAccountBalances(customer.id, scope),
      loadPaymentIntakeOrdersForCustomer({
        customerId: customer.id,
        weekCodeForOpenBalances: week,
        paymentWorkCountryRaw: "TURKEY",
      }),
    ]);
    assert.equal(intake.ok, true);
    if (!intake.ok) return;
    const weekRem = sumPaymentIntakeWeekScopedRemainingUsd(intake.orders);
    const grossCredit = await getCustomerCreditBalanceUsd(customer.id, { sourceCountry: COUNTRY });
    const creditShown = availableCreditForWeekScopedPayable({
      weekScopedDebtUsd: weekRem,
      ssotAvailableCreditUsd: grossCredit,
    });
    const books = normalizeExclusiveCustomerBooks({
      openDebtUsd: weekRem,
      availableCreditUsd: creditShown,
    });
    assert.ok(eq(books.openDebtUsd, accounts.openDebtUsd));
    assert.ok(eq(books.availableCreditUsd, accounts.availableCreditUsd));
    assert.ok(eq(books.netBalanceUsd, accounts.netBalanceUsd));
  });

  it("default intake week is HISTORICAL and must not be compared to CURRENT lifetime", async () => {
    const week = defaultPaymentIntakeWeekCode();
    const scope = resolvePaymentIntakeFinancialScope({
      weekCode: week,
      workCountry: "TURKEY",
    });
    assert.equal(scope.financial.kind, "HISTORICAL");
    const currentWeek = getCurrentBusinessWeek().currentBusinessWeekId;
    assert.notEqual(week, currentWeek);
  });

  it("cancelled payments are excluded and cash engine may ignore credit FIFO", async () => {
    const customer = await khalil();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const [cancelled, accounts, cash] = await Promise.all([
      prisma.payment.findMany({
        where: { customerId: customer.id, status: "CANCELLED" },
        select: { amountUsd: true },
      }),
      getCustomerAccountBalances(customer.id, currentCustomerFinancialScope(COUNTRY)),
      calculateCustomerBalance(customer.id, { sourceCountry: COUNTRY }),
    ]);
    assert.ok(cancelled.length >= 1);
    const cashOpen = money(cash.balance) > EPS ? money(cash.balance) : 0;
    if (accounts.availableCreditUsd > EPS) {
      assert.ok(
        cashOpen + EPS >= accounts.openDebtUsd,
        "cash-only remaining is >= exclusive open debt when credit exists",
      );
    }
  });

  it("partial remaining, overpay credit, mixed methods, and later-week order all exist", async () => {
    const customer = await khalil();
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const [orders, payments, credits, fees] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: customer.id, deletedAt: null },
        select: { orderNumber: true, weekCode: true, totalUsd: true, status: true },
      }),
      prisma.payment.findMany({
        where: { customerId: customer.id, status: { not: "CANCELLED" } },
        select: {
          businessType: true,
          usdPaymentMethod: true,
          ilsPaymentMethod: true,
          paymentCode: true,
        },
      }),
      prisma.payment.findMany({
        where: { customerId: customer.id, businessType: "CUSTOMER_CREDIT", status: { not: "CANCELLED" } },
        select: { amountUsd: true },
      }),
      prisma.paymentAdjustmentFee.findMany({
        where: { customerId: customer.id, status: { not: "CANCELLED" } },
        select: { userChoice: true, amountUsd: true },
      }),
    ]);
    assert.ok(orders.some((o) => o.orderNumber === "TR-140-0001"));
    assert.ok(orders.some((o) => o.weekCode === "AH-145"));
    assert.ok(payments.some((p) => p.businessType === "STANDARD"));
    assert.ok(credits.length >= 1);
    assert.ok(fees.some((f) => f.userChoice === "commission"));
    assert.ok(
      payments.some((p) => p.usdPaymentMethod && p.ilsPaymentMethod && p.usdPaymentMethod !== p.ilsPaymentMethod),
    );
  });
});
