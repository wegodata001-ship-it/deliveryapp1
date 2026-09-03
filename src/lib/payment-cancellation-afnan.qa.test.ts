/**
 * Regression — אפנאן #109.
 * אחרי ביטול TR-P-000006 / TR-P-000007 אסור שעמלות העודף יישארו OPEN.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { PAYMENT_RECORD_STATUS_CANCELLED } from "@/lib/payment-record-status-shared";

const EXPECTED = {
  openDebtUsd: 7362.9,
  totalPaymentsUsd: 0,
  availableCreditUsd: 0,
  commissionBalanceUsd: 72.9,
} as const;

const CANCELLED_CAPTURES = ["TR-P-000006", "TR-P-000007"] as const;

describe("Afnan #109 payment-cancellation regression", () => {
  it("debt $7,362.90 / payments $0 / credit $0 / fees $72.90 and cancelled captures have cancelled fees", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "109", deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!customer) {
      console.warn("skip: customer 109 not in this database");
      return;
    }

    const accounts = await getCustomerAccountBalances(customer.id);
    assert.equal(accounts.openDebtUsd, EXPECTED.openDebtUsd);
    assert.equal(accounts.totalPaymentsUsd, EXPECTED.totalPaymentsUsd);
    assert.equal(accounts.availableCreditUsd, EXPECTED.availableCreditUsd);
    assert.equal(accounts.commissionBalanceUsd, EXPECTED.commissionBalanceUsd);

    for (const code of CANCELLED_CAPTURES) {
      const payments = await prisma.payment.findMany({
        where: { customerId: customer.id, paymentCode: code },
        select: { id: true, status: true, paymentNumber: true },
      });
      assert.ok(payments.length > 0, `${code} must exist`);
      assert.ok(
        payments.every((p) => p.status === PAYMENT_RECORD_STATUS_CANCELLED),
        `${code} payment must be CANCELLED`,
      );

      const number = payments[0]?.paymentNumber;
      const siblingIds = (
        number != null
          ? await prisma.payment.findMany({
              where: { customerId: customer.id, paymentNumber: number },
              select: { id: true },
            })
          : payments
      ).map((p) => p.id);

      const fees = await prisma.paymentAdjustmentFee.findMany({
        where: {
          customerId: customer.id,
          OR: [{ paymentId: { in: siblingIds } }, { paymentCaptureCode: code }],
        },
        select: { id: true, status: true, amountUsd: true },
      });
      assert.ok(fees.length > 0, `${code} must have a linked adjustment fee`);
      assert.ok(
        fees.every((f) => f.status === "CANCELLED"),
        `${code} linked fees must be CANCELLED`,
      );
    }
  });
});
