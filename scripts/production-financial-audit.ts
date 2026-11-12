/**
 * Read-only production audit. Not part of npm run qa:all.
 * Prints snapshot drift and fails only when the financial engines disagree.
 * Does not write, reset, or update expected business totals.
 */
import { prisma } from "@/lib/prisma";
import { getCustomerAccountBalances } from "@/lib/customer-account-balances";
import { buildCustomerAccountLedger } from "@/lib/customer-account-ledger";
import { historicalCustomerFinancialScope } from "@/lib/customer-financial-scope";
import { assertNotProductionDataTarget } from "@/lib/staging-guard";

const BASELINE = [
  { code: "101", scope: "CURRENT", field: "openDebtUsd", baseline: 758.01 },
  { code: "101", scope: "2026-09-19", field: "openDebtUsd", baseline: 5594.17 },
  { code: "102", scope: "CURRENT", field: "commissionBalanceUsd", baseline: 62.5 },
  { code: "106", scope: "CURRENT", field: "openDebtUsd", baseline: 0.33 },
  { code: "107", scope: "CURRENT", field: "openDebtUsd", baseline: 0 },
  { code: "109", scope: "CURRENT", field: "openDebtUsd", baseline: 7362.9 },
] as const;

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  if (process.argv.includes("--write")) {
    assertNotProductionDataTarget(process.env);
    throw new Error("This audit is read-only");
  }

  let engineFailures = 0;
  for (const code of ["100", "101", "102", "105", "106", "107", "109"]) {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: code, deletedAt: null },
      select: { id: true },
    });
    if (!customer) continue;
    const accounts = await getCustomerAccountBalances(customer.id);
    const ledger = await buildCustomerAccountLedger({ customerId: customer.id, sourceCountry: "TURKEY" });
    const debtOk = accounts.openDebtUsd === r2(Number(ledger.openDebtUsd));
    const payOk = accounts.totalPaymentsUsd === r2(Number(ledger.totalPaymentsUsd));
    if (!debtOk || !payOk) {
      engineFailures += 1;
      console.error(`${code} engine mismatch debt=${debtOk} payments=${payOk}`);
    }
  }

  const historicalCustomer = await prisma.customer.findFirst({
    where: { customerCode: "101", deletedAt: null },
    select: { id: true },
  });
  if (historicalCustomer) {
    const scope = historicalCustomerFinancialScope({ cutoffYmd: "2026-09-19", sourceCountry: "TURKEY" });
    const accounts = await getCustomerAccountBalances(historicalCustomer.id, scope);
    const ledger = await buildCustomerAccountLedger({
      customerId: historicalCustomer.id,
      sourceCountry: "TURKEY",
      toYmd: "2026-09-19",
    });
    if (accounts.openDebtUsd !== r2(Number(ledger.openDebtUsd))) {
      engineFailures += 1;
      console.error("101 historical engine mismatch");
    }
  }

  for (const row of BASELINE) {
    const customer = await prisma.customer.findFirst({
      where: { customerCode: row.code, deletedAt: null },
      select: { id: true },
    });
    if (!customer) continue;
    const scope =
      row.scope === "CURRENT"
        ? undefined
        : historicalCustomerFinancialScope({ cutoffYmd: row.scope, sourceCountry: "TURKEY" });
    const accounts = await getCustomerAccountBalances(customer.id, scope);
    const actual = accounts[row.field];
    const delta = r2(actual - row.baseline);
    console.log(`${row.code} ${row.scope} ${row.field} baseline=${row.baseline} actual=${actual} delta=${delta}`);
  }

  if (engineFailures > 0) process.exit(1);
  console.log("Engines agree. Baseline deltas are data drift, not a calculation failure.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "audit failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
