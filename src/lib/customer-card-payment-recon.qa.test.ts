/**
 * Customer card payment reconciliation — display SSOT.
 * Read-only. No financial writes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { paymentReconciliationInvariantsHold } from "@/lib/payment-reconciliation-ssot";

describe("customer card payment reconciliation", () => {
  it("101 TR-P-000027 shows received/applied/surplus/open after 0", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }
    const ledger = await buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: "TURKEY" });
    const row = ledger.rows.find((r) => r.document === "TR-P-000027");
    assert.ok(row, "TR-P-000027 missing from ledger");
    const recon = row.paymentReconciliation;
    assert.ok(recon, "paymentReconciliation missing");
    assert.equal(recon.receivedAmount, 800);
    assert.equal(recon.appliedToDebt, 758.01);
    assert.equal(recon.surplusToCommission, 41.99);
    assert.equal(recon.surplusDestination, "commission");
    assert.equal(recon.openDebtBefore, 758.01);
    assert.equal(recon.openDebtAfter, 0);
    assert.ok(paymentReconciliationInvariantsHold(recon));
  });

  it("all customers: payment recon invariants hold", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });
    let payments = 0;
    let match = 0;
    const mismatches: string[] = [];
    for (const customer of customers) {
      const ledger = await buildCustomerAccountLedger({
        customerId: customer.id,
        sourceCountry: "TURKEY",
      });
      for (const row of ledger.rows) {
        if (row.kind !== "PAYMENT" || row.isPaymentCancelled || !row.paymentReconciliation) continue;
        payments += 1;
        const r = row.paymentReconciliation;
        const ok = paymentReconciliationInvariantsHold(r);
        if (ok) match += 1;
        else {
          mismatches.push(
            `${customer.customerCode} ${row.document} before=${r.openDebtBefore} recv=${r.receivedAmount} applied=${r.appliedToDebt} after=${r.openDebtAfter}`,
          );
        }
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join("\n"));
    assert.equal(match, payments);
    assert.ok(payments > 0);
  });
});
