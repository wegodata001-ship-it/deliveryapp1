/**
 * READ-ONLY master financial audit — every customer, no writes.
 * Compares SSOT vs intake vs ledger vs fees vs cancellation/orphan integrity.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { getCustomerAccountBalances } from "../src/lib/customer-account-balances";
import { getCustomerOpenDebt, openDebtScopeForWorkCountry } from "../src/lib/customer-open-debt";
import { buildCustomerAccountLedger } from "../src/lib/customer-account-ledger";
import { buildCustomerCommissionLedger } from "../src/lib/customer-commission-ledger";
import { loadPaymentIntakeBalancesForCustomer } from "../src/lib/payment-intake-load";
import { loadPaymentIntakeOrdersForCustomer } from "../src/lib/payment-intake-load";
import { scanLivePaymentCancellationIntegrity } from "../src/lib/payment-cancellation-integrity-scan";
import { DEFAULT_WORK_COUNTRY } from "../src/lib/work-country";
import { getCurrentAhWeek } from "../src/lib/weeks/ah-week";
import { isOrderLedgerFinancialField } from "../src/lib/order-update-audit";

const EPS = 0.02;
const SCOPE = openDebtScopeForWorkCountry(DEFAULT_WORK_COUNTRY);

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function eq(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) <= EPS;
}

export type AuditFail = {
  customerId: string;
  code: string;
  name: string;
  kind: string;
  expected: string;
  found: string;
  difference: string;
  records: string[];
  rootCause: string;
  safeFix: string;
};

export type CustomerAuditRow = {
  code: string;
  name: string;
  customerId: string;
  debtSsot: number;
  balances: number;
  paymentScreen: number;
  card: number;
  credit: number;
  fees: number;
  orders: "PASS" | "FAIL";
  payments: "PASS" | "FAIL";
  result: "PASS" | "FAIL";
  failKinds: string[];
};

function fail(
  customer: { id: string; customerCode: string | null; displayName: string },
  kind: string,
  expected: string,
  found: string,
  records: string[],
  rootCause: string,
  safeFix: string,
): AuditFail {
  return {
    customerId: customer.id,
    code: customer.customerCode ?? "—",
    name: customer.displayName,
    kind,
    expected,
    found,
    difference: `${expected} vs ${found}`,
    records,
    rootCause,
    safeFix,
  };
}

async function auditCustomer(customer: {
  id: string;
  customerCode: string | null;
  displayName: string;
}): Promise<{ row: CustomerAuditRow; fails: AuditFail[] }> {
  const fails: AuditFail[] = [];
  const currentWeek = getCurrentAhWeek().code;

  const [ssot, debt, intakeBal, intakeOrders, ledger, commission] = await Promise.all([
    getCustomerAccountBalances(customer.id, SCOPE),
    getCustomerOpenDebt(customer.id, SCOPE),
    loadPaymentIntakeBalancesForCustomer({
      customerId: customer.id,
      paymentWorkCountryRaw: DEFAULT_WORK_COUNTRY,
    }),
    loadPaymentIntakeOrdersForCustomer({
      customerId: customer.id,
      weekCodeForOpenBalances: currentWeek,
      paymentWorkCountryRaw: DEFAULT_WORK_COUNTRY,
    }),
    buildCustomerAccountLedger({ customerId: customer.id }),
    buildCustomerCommissionLedger(customer.id),
  ]);

  const debtSsot = money(ssot.openDebtUsd);
  const creditSsot = money(ssot.availableCreditUsd);
  const feesSsot = money(ssot.commissionBalanceUsd);
  const intakeDebt = intakeBal.ok ? money(intakeBal.openDebtSignedUsd) : NaN;
  const intakeCredit = intakeBal.ok ? money(intakeBal.creditBalanceUsd) : NaN;
  const intakeFees = intakeBal.ok ? money(intakeBal.commissionBalanceUsd) : NaN;
  const cardDebt = money(Number(ledger.openDebtUsd));
  const cardCredit = money(Number(ledger.availableCreditUsd));
  const cardFees = money(Number(ledger.commissionBalanceUsd));
  const intakeRemaining = intakeOrders.ok
    ? money(intakeOrders.orders.reduce((s, o) => s + Number(o.dbRemainingUsd), 0))
    : NaN;

  if (!eq(debtSsot, Number(debt.openDebtUsd))) {
    fails.push(
      fail(
        customer,
        "DEBT_SSOT_INTERNAL",
        `$${debtSsot.toFixed(2)}`,
        `openDebt $${Number(debt.openDebtUsd).toFixed(2)}`,
        [],
        "getCustomerAccountBalances and getCustomerOpenDebt diverged",
        "Compare calculateCustomerBalance vs account openDebt clamp",
      ),
    );
  }
  if (!intakeBal.ok) {
    fails.push(fail(customer, "PAYMENT_SCREEN", `$${debtSsot.toFixed(2)}`, intakeBal.error, [], "Intake balances failed to load", "Investigate intake loader"));
  } else {
    if (!eq(debtSsot, intakeDebt)) {
      fails.push(
        fail(
          customer,
          "DEBT_PAYMENT_SCREEN",
          `$${debtSsot.toFixed(2)}`,
          `$${intakeDebt.toFixed(2)}`,
          [],
          "Payment intake openDebtSignedUsd != SSOT",
          "Intake must read getCustomerAccountBalances without week wipe",
        ),
      );
    }
    if (!eq(creditSsot, intakeCredit)) {
      fails.push(
        fail(
          customer,
          "CREDIT_PAYMENT_SCREEN",
          `$${creditSsot.toFixed(2)}`,
          `$${intakeCredit.toFixed(2)}`,
          [],
          "Payment intake credit != SSOT",
          "Same getCustomerCreditBalanceUsd in both surfaces",
        ),
      );
    }
    if (!eq(feesSsot, intakeFees)) {
      fails.push(
        fail(
          customer,
          "FEE_PAYMENT_SCREEN",
          `$${feesSsot.toFixed(2)}`,
          `$${intakeFees.toFixed(2)}`,
          [],
          "Payment intake fees != SSOT",
          "Same getCustomerCommissionBalanceUsd in both surfaces",
        ),
      );
    }
  }
  if (!eq(debtSsot, cardDebt)) {
    fails.push(fail(customer, "DEBT_CARD", `$${debtSsot.toFixed(2)}`, `$${cardDebt.toFixed(2)}`, [], "Ledger header debt != SSOT", "Ledger header must use getCustomerAccountBalances"));
  }
  if (!eq(creditSsot, cardCredit)) {
    fails.push(fail(customer, "CREDIT_CARD", `$${creditSsot.toFixed(2)}`, `$${cardCredit.toFixed(2)}`, [], "Ledger header credit != SSOT", "Ledger header must use availableCreditUsd"));
  }
  if (!eq(feesSsot, cardFees)) {
    fails.push(fail(customer, "FEE_CARD", `$${feesSsot.toFixed(2)}`, `$${cardFees.toFixed(2)}`, [], "Ledger header fees != SSOT", "Ledger header must use commissionBalanceUsd"));
  }
  if (Number.isFinite(intakeRemaining) && !eq(debtSsot, intakeRemaining)) {
    fails.push(
      fail(
        customer,
        "DEBT_INTAKE_REMAINING",
        `$${debtSsot.toFixed(2)}`,
        `Σ remaining $${intakeRemaining.toFixed(2)}`,
        intakeOrders.ok
          ? intakeOrders.orders.filter((o) => Number(o.dbRemainingUsd) > EPS).map((o) => `${o.orderNumber} remaining ${o.dbRemainingUsd}`)
          : [],
        "Collectible intake remaining after withdrawal FIFO != customer open debt",
        "Apply debt withdrawals FIFO onto order remainders; do not hide prior-week debt",
      ),
    );
  }

  const headerSigned = money(debtSsot - creditSsot);
  const lastRow = ledger.rows.at(-1);
  if (lastRow) {
    const lastBal = money(Number(lastRow.balanceUsd));
    if (!eq(lastBal, headerSigned)) {
      fails.push(
        fail(
          customer,
          "RUNNING_BALANCE",
          `SSOT signed $${headerSigned.toFixed(2)}`,
          `last ledger row $${lastBal.toFixed(2)} (${lastRow.document})`,
          [lastRow.document],
          "Chronological running balance does not land on current SSOT",
          "Replay ledger events oldest→newest; cancelled rows must not move the balance",
        ),
      );
    }
  } else if (Math.abs(headerSigned) > EPS) {
    fails.push(
      fail(
        customer,
        "RUNNING_BALANCE",
        `SSOT signed $${headerSigned.toFixed(2)}`,
        "empty ledger",
        [],
        "Customer has a non-zero SSOT but no ledger rows",
        "Ensure orders/payments/withdrawals are emitted as ledger events",
      ),
    );
  }

  const feeMoveLast = commission.movements.at(-1);
  if (feeMoveLast && !eq(feeMoveLast.balanceAfterUsd, commission.currentBalanceUsd)) {
    fails.push(
      fail(
        customer,
        "FEE_RECONCILE",
        `fee SSOT $${commission.currentBalanceUsd.toFixed(2)}`,
        `last fee movement running $${feeMoveLast.balanceAfterUsd.toFixed(2)}`,
        [],
        "Commission ledger running total != current fee SSOT",
        "Include every non-cancelled fee / order commission once; exclude CANCELLED",
      ),
    );
  } else if (!eq(feesSsot, commission.currentBalanceUsd)) {
    fails.push(
      fail(
        customer,
        "FEE_DETAIL",
        `$${feesSsot.toFixed(2)}`,
        `commission ledger $${commission.currentBalanceUsd.toFixed(2)}`,
        [],
        "Fee popover current balance != balances SSOT",
        "Both must call getCustomerCommissionBalanceUsd",
      ),
    );
  }

  const dbOrders = await prisma.order.findMany({
    where: { customerId: customer.id, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      weekCode: true,
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
    },
  });
  const ledgerOrderDocs = new Set(
    ledger.rows.filter((r) => r.kind === "ORDER" || r.kind === "ORDER_UPDATED").map((r) => r.document),
  );
  const missingOrders = dbOrders
    .filter((o) => o.status !== "CANCELLED")
    .filter((o) => o.orderNumber && !ledgerOrderDocs.has(o.orderNumber));
  if (missingOrders.length > 0) {
    fails.push(
      fail(
        customer,
        "MISSING_ORDERS_IN_CARD",
        "every live order on ledger",
        missingOrders.map((o) => o.orderNumber).join(", "),
        missingOrders.map((o) => o.orderNumber ?? o.id),
        "Order exists in DB but has no ledger order row",
        "Emit ORDER / DEBT_WITHDRAWAL events for all non-deleted orders",
      ),
    );
  }

  const dbPayments = await prisma.payment.findMany({
    where: { customerId: customer.id },
    select: {
      id: true,
      paymentCode: true,
      paymentNumber: true,
      status: true,
      businessType: true,
      amountUsd: true,
    },
  });
  const ledgerPayDocs = new Set(
    ledger.rows.filter((r) => r.kind === "PAYMENT").map((r) => r.document),
  );
  const missingPays = dbPayments.filter((p) => {
    if (p.businessType === "CUSTOMER_CREDIT" || p.businessType === "ADJUSTMENT_FEE") return false;
    const code = p.paymentCode?.trim();
    if (!code) return false;
    return !ledgerPayDocs.has(code);
  });
  if (missingPays.length > 0) {
    fails.push(
      fail(
        customer,
        "MISSING_PAYMENTS_IN_CARD",
        "every coded capture on ledger",
        missingPays.map((p) => p.paymentCode).join(", "),
        missingPays.map((p) => p.paymentCode ?? p.id),
        "Active/cancelled coded payment missing from ledger",
        "Ledger must list each paymentCode once; cancelled stays as history",
      ),
    );
  }

  const cancelledOnLedger = ledger.rows.filter((r) => r.isPaymentCancelled);
  for (const row of cancelledOnLedger) {
    const pay = money(Number(row.paymentUsd));
    if (Math.abs(pay) > EPS) {
      fails.push(
        fail(
          customer,
          "CANCELLED_STILL_COUNTS",
          "$0 effect from cancelled payment",
          `${row.document} paymentUsd ${row.paymentUsd}`,
          [row.document],
          "Cancelled payment still moves running balance",
          "isPaymentCancelled rows must contribute $0 to running balance",
        ),
      );
    }
  }

  const olderOpen = dbOrders.filter((o) => {
    if (o.status === "CANCELLED" || o.status === "DEBT_WITHDRAWAL") return false;
    return o.weekCode && o.weekCode !== currentWeek;
  });
  if (olderOpen.length > 0 && intakeOrders.ok) {
    const intakeIds = new Set(intakeOrders.orders.map((o) => o.id));
    const dropped = olderOpen.filter((o) => !intakeIds.has(o.id));
    if (dropped.length > 0) {
      fails.push(
        fail(
          customer,
          "WEEK_DROPPED_DEBT",
          `prior-week orders still in ${currentWeek} intake`,
          dropped.map((o) => `${o.orderNumber} ${o.weekCode}`).join(", "),
          dropped.map((o) => o.orderNumber ?? o.id),
          "Intake week filter dropped an older order",
          "Filter by orderDate <= week end, never weekCode equality",
        ),
      );
    }
  }

  const notesOnlyFinancial = await prisma.auditLog.findMany({
    where: { actionType: "ORDER_UPDATED", entityId: { in: dbOrders.map((o) => o.id) } },
    select: { entityId: true, metadata: true },
  });
  for (const log of notesOnlyFinancial) {
    const meta = log.metadata as Record<string, unknown> | null;
    if (!meta || meta.financialLedger === true || meta.ledgerKind === "ORDER_UPDATE") continue;
    const changes = Array.isArray(meta.changes) ? meta.changes : [];
    const financial = changes.some((item) => {
      if (!item || typeof item !== "object") return false;
      const c = item as { field?: string; label?: string };
      return isOrderLedgerFinancialField(String(c.field ?? ""), String(c.label ?? ""));
    });
    if (financial) {
      fails.push(
        fail(
          customer,
          "ORDER_UPDATE_MISSING_LEDGER",
          "financial ORDER_UPDATED has ledgerKind",
          String(meta.orderNumber ?? log.entityId),
          [String(meta.orderNumber ?? log.entityId)],
          "Financial order edit audit lacks ledgerKind",
          "Set ledgerKind only when money fields change; notes-only stays audit-only",
        ),
      );
    }
  }

  const kinds = [...new Set(fails.map((f) => f.kind))];
  const row: CustomerAuditRow = {
    code: customer.customerCode ?? "—",
    name: customer.displayName,
    customerId: customer.id,
    debtSsot,
    balances: debtSsot,
    paymentScreen: Number.isFinite(intakeDebt) ? intakeDebt : NaN,
    card: cardDebt,
    credit: creditSsot,
    fees: feesSsot,
    orders: missingOrders.length ? "FAIL" : "PASS",
    payments: missingPays.length ? "FAIL" : "PASS",
    result: fails.length ? "FAIL" : "PASS",
    failKinds: kinds,
  };
  return { row, fails };
}

async function scanOrphans() {
  const [paymentsNoCustomer, allocs, fees, integrity] = await Promise.all([
    prisma.payment.count({ where: { customerId: null } }),
    prisma.paymentMethodAllocation.findMany({ select: { id: true, paymentId: true } }),
    prisma.paymentAdjustmentFee.findMany({
      select: { id: true, paymentId: true, paymentCaptureCode: true, status: true, customerId: true },
    }),
    scanLivePaymentCancellationIntegrity(),
  ]);
  const paymentIds = new Set((await prisma.payment.findMany({ select: { id: true } })).map((p) => p.id));
  const orphanAllocs = allocs.filter((a) => !paymentIds.has(a.paymentId)).length;
  const orphanFees = fees.filter((f) => f.paymentId && !paymentIds.has(f.paymentId)).length;
  return {
    paymentsNoCustomer,
    orphanAllocs,
    orphanFees,
    cancellationAnomalies: integrity.anomalies,
  };
}

async function main() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, customerCode: true, displayName: true },
    orderBy: [{ customerCode: "asc" }],
  });

  const rows: CustomerAuditRow[] = [];
  const fails: AuditFail[] = [];
  for (const customer of customers) {
    const result = await auditCustomer(customer);
    rows.push(result.row);
    fails.push(...result.fails);
  }

  const orphans = await scanOrphans();
  const summary = {
    generatedAt: new Date().toISOString(),
    currentWeek: getCurrentAhWeek().code,
    totalCustomers: customers.length,
    fullPass: rows.filter((r) => r.result === "PASS").length,
    failed: rows.filter((r) => r.result === "FAIL").length,
    debtMismatches: fails.filter((f) => f.kind.startsWith("DEBT")).length,
    creditMismatches: fails.filter((f) => f.kind.startsWith("CREDIT")).length,
    feeMismatches: fails.filter((f) => f.kind.startsWith("FEE")).length,
    missingPaymentsInCard: fails.filter((f) => f.kind === "MISSING_PAYMENTS_IN_CARD").length,
    missingOrdersInCard: fails.filter((f) => f.kind === "MISSING_ORDERS_IN_CARD").length,
    cancelledPaymentLeftovers: orphans.cancellationAnomalies.filter((a) =>
      a.kind.startsWith("CANCELLED_PAYMENT"),
    ).length,
    runningBalanceMismatches: fails.filter((f) => f.kind === "RUNNING_BALANCE").length,
    weekDropped: fails.filter((f) => f.kind === "WEEK_DROPPED_DEBT").length,
    orphans: {
      paymentsNoCustomer: orphans.paymentsNoCustomer,
      allocationsMissingPayment: orphans.orphanAllocs,
      feesMissingPayment: orphans.orphanFees,
      cancellationAnomalies: orphans.cancellationAnomalies.length,
    },
  };

  const report = { summary, rows, fails, cancellationAnomalies: orphans.cancellationAnomalies };
  writeFileSync("scripts/.tmp-master-financial-audit.json", JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote scripts/.tmp-master-financial-audit.json (${rows.length} customers, ${fails.length} fails)`);
}

main().finally(() => prisma.$disconnect());
