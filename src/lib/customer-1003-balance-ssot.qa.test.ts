/**
 * Regression — לקוח 1003.
 * הנתונים ב-DB תקינים; המבחן מוודא שכל הצרכנים קוראים את אותו SSOT.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { buildCustomerCommissionLedger } from "@/lib/customer-commission-ledger";
import { buildOrderCommissionDetailView } from "@/lib/order-commission-ssot";
import { formatCommissionEquation } from "@/lib/commission-lineage-view";
import { computeOrderLedgerView } from "@/lib/order-remaining-debt";
import { activePaidPaymentWhere } from "@/lib/payment-record-status";

const EXPECTED = {
  openDebtUsd: 0,
  availableCreditUsd: 15,
  commissionBalanceUsd: 23,
} as const;

describe("customer 1003 balance SSOT", () => {
  it("open debt $0 / credit $15 / commission $23", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "1003", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 1003 not in this database");
      return;
    }

    const accounts = await getCustomerAccountBalances(customer.id);
    assert.equal(accounts.openDebtUsd, EXPECTED.openDebtUsd);
    assert.equal(accounts.availableCreditUsd, EXPECTED.availableCreditUsd);
    assert.equal(accounts.commissionBalanceUsd, EXPECTED.commissionBalanceUsd);

    const ledger = await buildCustomerAccountLedger({ customerId: customer.id });
    assert.equal(Number(ledger.openDebtUsd), EXPECTED.openDebtUsd);
    assert.equal(Number(ledger.availableCreditUsd), EXPECTED.availableCreditUsd);
    assert.equal(Number(ledger.commissionBalanceUsd), EXPECTED.commissionBalanceUsd);
    assert.equal(Number(ledger.balanceUsd), -EXPECTED.availableCreditUsd);

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
    assert.equal(
      ledger.rows.filter((r) => r.kind === "BALANCE_RESET" || r.isBalanceReset).length,
      0,
      "Mohammad has no persisted direct reset — do not invent one",
    );

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
      assert.equal(ledgerView.totalUsd, 1515);
      assert.equal(ledgerView.paidUsd, 1515);
      assert.equal(ledgerView.remainingUsd, 0);
      assert.equal(Number(order.commissionUsd), 15);

      const fees = await prisma.paymentAdjustmentFee.findMany({
        where: { orderId: order.id, status: { not: "CANCELLED" } },
        select: {
          id: true,
          amountUsd: true,
          userChoice: true,
          paymentCaptureCode: true,
          payment: { select: { paymentCode: true } },
        },
      });
      const detail = buildOrderCommissionDetailView({
        orderId: order.id,
        orderNumber: "TR-137-0006",
        baseCommissionUsd: Number(order.commissionUsd ?? 0),
        fees: fees.map((f) => ({
          id: f.id,
          amountUsd: Number(f.amountUsd ?? 0),
          userChoice: f.userChoice,
          paymentCaptureCode: f.paymentCaptureCode,
          paymentCode: f.payment?.paymentCode ?? null,
        })),
      });
      assert.equal(detail.currentCommissionUsd, 23);
      assert.equal(detail.movements.length, 3);
      assert.equal(detail.movements[0]!.label, "עמלה מקורית");
      assert.equal(detail.movements[0]!.amountUsd, 15);
      const addAmounts = detail.movements.slice(1).map((m) => m.amountUsd).sort((a, b) => a - b);
      assert.deepEqual(addAmounts, [3, 5]);
      assert.ok(detail.movements.slice(1).every((m) => m.label === "תוספת עמלה"));
      assert.equal(formatCommissionEquation([15, 3, 5]), "$15 + $3 + $5 = $23");
      assert.match(
        formatCommissionEquation(detail.movements.map((m) => m.amountUsd)),
        /\$15 \+ \$[35] \+ \$[35] = \$23/,
      );
    }

    const commissionLedger = await buildCustomerCommissionLedger(customer.id);
    assert.equal(commissionLedger.currentBalanceUsd, 23);
    assert.equal(commissionLedger.movements.length, 3);
    assert.equal(commissionLedger.movements[0]!.actionLabel, "עמלה מקורית");
    assert.ok(commissionLedger.movements.slice(1).every((m) => m.actionLabel === "תוספת עמלה"));
    assert.deepEqual(
      commissionLedger.movements.slice(1).map((m) => m.amountUsd).sort((a, b) => a - b),
      [3, 5],
    );
  });
});
