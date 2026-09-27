/**
 * INVARIANT: אחרי מנוע ה-SSOT, אסור חוב פתוח ויתרת זכות יחד.
 * Read-only. לא כותב ל-DB.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "@/lib/prisma";
import {
  assertExclusiveCustomerBooks,
  getCustomerAccountBalances,
  getCustomerAccountBalancesMany,
} from "@/lib/customer-account-balances";
import { matchesCustomerNetBalanceFilter } from "@/lib/customer-account-balances-shared";
import { buildPaymentPreview } from "@/lib/payment-intake-preview";
import { calculateCustomerBalance } from "@/lib/customer-balance-calculator";
import { getCustomerCreditBalanceUsd } from "@/lib/customer-credit-balance";
import { currentCustomerFinancialScope } from "@/lib/customer-financial-scope";
import { isCustomerDebtExcludedPayment } from "@/lib/payment-adjustment-fee";

const CURRENT = currentCustomerFinancialScope("TURKEY");
const EPS = 0.01;

describe("exclusive customer books invariant", () => {
  it("every CURRENT SSOT row is debt XOR credit XOR zero", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const many = await getCustomerAccountBalancesMany(
      customers.map((c) => c.id),
      CURRENT,
    );
    const violations: string[] = [];
    for (const c of customers) {
      const row = many.get(c.id);
      assert.ok(row, `missing SSOT for ${c.customerCode}`);
      if (row!.openDebtUsd > EPS && row!.availableCreditUsd > EPS) {
        violations.push(
          `${c.customerCode} debt=${row!.openDebtUsd} credit=${row!.availableCreditUsd}`,
        );
      }
      assertExclusiveCustomerBooks(row!);
    }
    assert.equal(violations.length, 0, violations.join("\n"));
  });

  it("ALL customers appear: Debt + Credit + Balanced = All", async () => {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, customerCode: true },
    });
    if (customers.length === 0) {
      console.warn("skip: no customers");
      return;
    }
    const many = await getCustomerAccountBalancesMany(
      customers.map((c) => c.id),
      CURRENT,
    );
    let debt = 0;
    let credit = 0;
    let balanced = 0;
    for (const c of customers) {
      const row = many.get(c.id);
      assert.ok(row, `missing SSOT row for ${c.customerCode}`);
      const net = row!.netBalanceUsd;
      if (matchesCustomerNetBalanceFilter(net, "OWES")) debt += 1;
      else if (matchesCustomerNetBalanceFilter(net, "CREDIT")) credit += 1;
      else balanced += 1;
    }
    assert.equal(debt + credit + balanced, customers.length);
    assert.equal(many.size, customers.length);
  });

  it("customer 101: credit is not inside debt payments, then exclusive net is 758.01 / 0", async () => {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: "101", deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      console.warn("skip: customer 101 missing");
      return;
    }

    const [calc, grossCredit, ssot] = await Promise.all([
      calculateCustomerBalance(customer.id),
      getCustomerCreditBalanceUsd(customer.id),
      getCustomerAccountBalances(customer.id, CURRENT),
    ]);

    const debtPayments = Number(calc.totalPayments.toFixed(2));
    const grossDebt = Number(calc.balance.toFixed(2));
    assert.equal(grossDebt, 2031.84);
    assert.equal(grossCredit, 1273.83);
    assert.equal(debtPayments, 15895.66);
    assert.notEqual(
      Number((debtPayments + grossCredit).toFixed(2)),
      debtPayments,
      "CUSTOMER_CREDIT must not already be inside debt payments",
    );
    assert.equal(isCustomerDebtExcludedPayment("CUSTOMER_CREDIT"), true);

    assert.equal(ssot.openDebtUsd, 758.01);
    assert.equal(ssot.availableCreditUsd, 0);
    assert.equal(ssot.netBalanceUsd, -758.01);
    assertExclusiveCustomerBooks(ssot);

    const preview = buildPaymentPreview({
      financialState: {
        openDebtUsd: ssot.openDebtUsd,
        availableCreditUsd: ssot.availableCreditUsd,
        commissionBalanceUsd: ssot.commissionBalanceUsd,
      },
      draftPaymentUsd: 100,
    });
    assert.equal(preview.remainingDebt, 658.01);
    assert.equal(preview.projectedCredit, 0);
  });
});
