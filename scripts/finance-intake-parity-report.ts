/**
 * Batch Payment Intake parity report: Legacy vs Finance Data Layer V2.
 *
 * Usage:
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/finance-intake-parity-report.ts
 *   node -r ./scripts/shims/register-server-only.cjs --import tsx scripts/finance-intake-parity-report.ts --limit=50
 */

import { prisma } from "@/lib/prisma";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";
import { toLegacyParityOrders } from "@/lib/payment-intake-parity-adapter";
import {
  formatParityReportTable,
  mergeParityReports,
  runPaymentIntakeParity,
  type PaymentIntakeParityReport,
} from "@/lib/finance-data/parity/payment-intake-parity";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";

async function main() {
  process.env.FINANCE_INTAKE_PARITY = "0"; // avoid double-run from load hook
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 100;

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isActive: true, orders: { some: { deletedAt: null } } },
    select: { id: true, customerCode: true, displayName: true },
    take: Number.isFinite(limit) ? limit : 100,
    orderBy: { updatedAt: "desc" },
  });

  const reports: PaymentIntakeParityReport[] = [];
  let processed = 0;

  for (const c of customers) {
    const loaded = await loadPaymentIntakeOrdersForCustomer({
      customerId: c.id,
      paymentWorkCountryRaw: DEFAULT_WORK_COUNTRY,
    });
    if (!loaded.ok) continue;
    if (loaded.orders.length === 0) continue;

    const report = await runPaymentIntakeParity({
      customerId: c.id,
      legacyOrders: toLegacyParityOrders(loaded.orders),
    });
    reports.push(report);
    processed += 1;
    if (processed % 10 === 0) {
      console.error(`… processed ${processed} customers with orders`);
    }
  }

  const merged = mergeParityReports(reports);
  console.log("\n=== Payment Intake Parity Report (Legacy vs Finance Data V2) ===\n");
  console.log(`Customers with orders checked:\t${reports.length}`);
  console.log(formatParityReportTable(merged));
  console.log("\n--- Sample diffs (max 30) ---");
  for (const d of merged.diffs.slice(0, 30)) {
    console.log(
      JSON.stringify({
        orderId: d.orderId,
        orderNumber: d.orderNumber,
        field: d.field,
        currency: d.currency,
        legacy: d.legacyValue,
        v2: d.v2Value,
        delta: d.delta,
      }),
    );
  }
  if (merged.validatorFailures.length > 0) {
    console.log("\n--- Validator failures (max 20) ---");
    for (const f of merged.validatorFailures.slice(0, 20)) {
      console.log(JSON.stringify({ orderId: f.orderId, validator: f.validator, issues: f.result.issues }));
    }
  }
  console.log(merged.fullParity ? "\nRESULT: 100% PARITY" : "\nRESULT: PARITY FAILED — do not switch Intake to V2 yet");
  process.exit(merged.fullParity ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
