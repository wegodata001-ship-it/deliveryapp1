/**
 * Regression — לקוח 1003.
 * המבחן מוודא שכל הצרכנים קוראים את אותו SSOT (לא דורס יתרות).
 * 2026-09-03: איפוס יתרת זכות $15 לעמלות — Credit $0 / Fees $38.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { buildCustomerCommissionLedger } from "@/lib/customer-commission-ledger";
import { sumActiveCommissionMovementUsd } from "@/lib/customer-commission-movements";
import { computeOrderLedgerView } from "@/lib/order-remaining-debt";
import { activePaidPaymentWhere } from "@/lib/payment-record-status";

describe("customer 1003 balance SSOT", () => {
  it("open debt / credit / fees aligned across balances, card, and fee details", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "1003", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 1003 not in this database");
      return;
    }

    const accounts = await getCustomerAccountBalances(customer.id);
    const ledger = await buildCustomerAccountLedger({ customerId: customer.id });
    const commissionLedger = await buildCustomerCommissionLedger(customer.id);

    assert.equal(Number(ledger.openDebtUsd), accounts.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), accounts.availableCreditUsd);
    assert.equal(Number(ledger.commissionBalanceUsd), accounts.commissionBalanceUsd);
    assert.equal(commissionLedger.currentBalanceUsd, accounts.commissionBalanceUsd);
    assert.equal(sumActiveCommissionMovementUsd(commissionLedger.movements), accounts.commissionBalanceUsd);

    const lastRow = ledger.rows.at(-1);
    if (lastRow) {
      assert.equal(
        Number(lastRow.balanceUsd),
        Number(ledger.balanceUsd),
        "ledger running balance must match SSOT summary",
      );
    }

    const paymentDocs = ledger.rows
      .filter((r) => r.kind === "PAYMENT" && !r.isPaymentCancelled)
      .map((r) => r.document);
    assert.ok(paymentDocs.includes("TR-P-000008"), "primary capture must stay on the card");
    assert.ok(paymentDocs.includes("TR-P-000009"), "second coded capture must stay on the card");
    assert.ok(paymentDocs.includes("TR-P-000010"), "third coded capture must stay on the card");

    const order = await prisma.order.findFirst({
      where: { orderNumber: "TR-137-0006", deletedAt: null },
      select: { id: true, totalUsd: true, amountUsd: true, commissionUsd: true },
    });
    if (order) {
      const paidAgg = await prisma.payment.aggregate({
        where: {
          orderId: order.id,
          amountUsd: { not: null },
          ...activePaidPaymentWhere,
          NOT: { businessType: { in: ["ADJUSTMENT_FEE", "CUSTOMER_CREDIT"] } },
        },
        _sum: { amountUsd: true },
      });
      const paid = Number(paidAgg._sum.amountUsd ?? 0);
      const ledgerView = computeOrderLedgerView({
        orderId: order.id,
        totalUsd: order.totalUsd,
        amountUsd: order.amountUsd,
        commissionUsd: order.commissionUsd,
        paidUsd: paid,
      });
      assert.equal(ledgerView.remainingUsd, 0);
      assert.equal(Number(order.commissionUsd), 15);
    }
  });
});
