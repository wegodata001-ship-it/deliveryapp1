/**
 * Full business-data reset (NOT master/system data).
 *
 * Usage:
 *   npx tsx scripts/reset-business-data.ts --confirm "RESET BUSINESS DATA"
 *   npx tsx scripts/reset-business-data.ts --confirm "RESET BUSINESS DATA" --skip-smoke
 *
 * - Backs up counts (+ small JSON samples) under .tmp-business-reset-backup/
 * - Deletes in FK-safe order inside a transaction
 * - Verifies zeros
 * - Optional smoke: create → verify → wipe → verify zeros again
 *
 * Does NOT drop tables, migrate, or modify schema.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

const CONFIRM_PHRASE = "RESET BUSINESS DATA";
const prisma = new PrismaClient();

type Counts = Record<string, number>;

const BUSINESS_COUNT_KEYS = [
  "PaymentCheck",
  "PaymentMethodAllocation",
  "PaymentAdjustmentFee",
  "PaymentCashAuditReview",
  "OrderPaymentBreakdown",
  "PaymentPlan",
  "ApprovalRequest",
  "Payment",
  "OrderEditRequest",
  "Order",
  "OrderWeekCounter",
  "ReceiptControl",
  "CustomerBalanceStatusOverride",
  "Customer",
  "CashExpense",
  "CashCount",
  "CashDailyDrawerCount",
  "TurkeyTransferMovement",
  "CashWeekFlow",
  "ExcelImportRow",
  "ExcelImportFile",
  "ManualImportRow",
  "ManualImport",
  "LegacyRawRow",
  "UserNotification",
  "ShipmentPaymentLine",
  "ShipmentRecordExpense",
  "ShipmentBatchExpense",
  "ShipmentRecord",
  "ShipmentCashExpense",
  "ShipmentCashCount",
  "ShipmentCashDay",
  "ShipmentBatch",
  "ManualShipment",
  "DeliveryLocationAudit",
  "Document",
  "InventoryCountLine",
  "InventoryCount",
  "AuditLog",
] as const;

const KEEP_COUNT_KEYS = [
  "User",
  "Permission",
  "UserPermission",
  "FinancialSettings",
  "AdminSystemSettings",
  "SourceStatus",
  "SourcePaymentMethod",
  "PaymentMethodRegistry",
  "PaymentPoint",
  "IntakeLocation",
  "OrderLocation",
  "PaymentLocation",
  "ShipmentDeliveryZone",
  "DeliveryLocation",
  "DeliveryLocationAlias",
  "ShipmentCourier",
  "ShipmentExpenseType",
  "ArabicDisplayNameCache",
  "InventoryItem",
] as const;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readConfirmArg(): string {
  const idx = process.argv.indexOf("--confirm");
  if (idx === -1) return "";
  return process.argv[idx + 1] ?? "";
}

async function countAll(): Promise<{ business: Counts; keep: Counts }> {
  const business: Counts = {};
  const keep: Counts = {};

  const map: Record<string, () => Promise<number>> = {
    PaymentCheck: () => prisma.paymentCheck.count(),
    PaymentMethodAllocation: () => prisma.paymentMethodAllocation.count(),
    PaymentAdjustmentFee: () => prisma.paymentAdjustmentFee.count(),
    PaymentCashAuditReview: () => prisma.paymentCashAuditReview.count(),
    OrderPaymentBreakdown: () => prisma.orderPaymentBreakdown.count(),
    PaymentPlan: () => prisma.paymentPlan.count(),
    ApprovalRequest: () => prisma.approvalRequest.count(),
    Payment: () => prisma.payment.count(),
    OrderEditRequest: () => prisma.orderEditRequest.count(),
    Order: () => prisma.order.count(),
    OrderWeekCounter: () => prisma.orderWeekCounter.count(),
    ReceiptControl: () => prisma.receiptControl.count(),
    CustomerBalanceStatusOverride: () => prisma.customerBalanceStatusOverride.count(),
    Customer: () => prisma.customer.count(),
    CashExpense: () => prisma.cashExpense.count(),
    CashCount: () => prisma.cashCount.count(),
    CashDailyDrawerCount: () => prisma.cashDailyDrawerCount.count(),
    TurkeyTransferMovement: () => prisma.turkeyTransferMovement.count(),
    CashWeekFlow: () => prisma.cashWeekFlow.count(),
    ExcelImportRow: () => prisma.excelImportRow.count(),
    ExcelImportFile: () => prisma.excelImportFile.count(),
    ManualImportRow: () => prisma.manualImportRow.count(),
    ManualImport: () => prisma.manualImport.count(),
    LegacyRawRow: () => prisma.legacyRawRow.count(),
    UserNotification: () => prisma.userNotification.count(),
    ShipmentPaymentLine: () => prisma.shipmentPaymentLine.count(),
    ShipmentRecordExpense: () => prisma.shipmentRecordExpense.count(),
    ShipmentBatchExpense: () => prisma.shipmentBatchExpense.count(),
    ShipmentRecord: () => prisma.shipmentRecord.count(),
    ShipmentCashExpense: () => prisma.shipmentCashExpense.count(),
    ShipmentCashCount: () => prisma.shipmentCashCount.count(),
    ShipmentCashDay: () => prisma.shipmentCashDay.count(),
    ShipmentBatch: () => prisma.shipmentBatch.count(),
    ManualShipment: () => prisma.manualShipment.count(),
    DeliveryLocationAudit: () => prisma.deliveryLocationAudit.count(),
    Document: () => prisma.document.count(),
    InventoryCountLine: () => prisma.inventoryCountLine.count(),
    InventoryCount: () => prisma.inventoryCount.count(),
    AuditLog: () => prisma.auditLog.count(),
    User: () => prisma.user.count(),
    Permission: () => prisma.permission.count(),
    UserPermission: () => prisma.userPermission.count(),
    FinancialSettings: () => prisma.financialSettings.count(),
    AdminSystemSettings: () => prisma.adminSystemSettings.count(),
    SourceStatus: () => prisma.sourceStatus.count(),
    SourcePaymentMethod: () => prisma.sourcePaymentMethod.count(),
    PaymentMethodRegistry: () => prisma.paymentMethodRegistry.count(),
    PaymentPoint: () => prisma.paymentPoint.count(),
    IntakeLocation: () => prisma.intakeLocation.count(),
    OrderLocation: () => prisma.orderLocation.count(),
    PaymentLocation: () => prisma.paymentLocation.count(),
    ShipmentDeliveryZone: () => prisma.shipmentDeliveryZone.count(),
    DeliveryLocation: () => prisma.deliveryLocation.count(),
    DeliveryLocationAlias: () => prisma.deliveryLocationAlias.count(),
    ShipmentCourier: () => prisma.shipmentCourier.count(),
    ShipmentExpenseType: () => prisma.shipmentExpenseType.count(),
    ArabicDisplayNameCache: () => prisma.arabicDisplayNameCache.count(),
    InventoryItem: () => prisma.inventoryItem.count(),
  };

  for (const key of BUSINESS_COUNT_KEYS) {
    business[key] = await map[key]();
  }
  for (const key of KEEP_COUNT_KEYS) {
    keep[key] = await map[key]();
  }
  return { business, keep };
}

async function writeBackup(dir: string, before: { business: Counts; keep: Counts }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "counts-before.json"), JSON.stringify(before, null, 2), "utf8");

  // Lightweight samples for restore guidance (not a full dump of huge tables)
  const samples = {
    customers: await prisma.customer.findMany({ take: 50 }),
    orders: await prisma.order.findMany({ take: 50 }),
    payments: await prisma.payment.findMany({ take: 50 }),
    shipmentBatches: await prisma.shipmentBatch.findMany({ take: 50 }),
    shipmentRecords: await prisma.shipmentRecord.findMany({ take: 50 }),
    manualShipments: await prisma.manualShipment.findMany({ take: 50 }),
    cashWeekFlows: await prisma.cashWeekFlow.findMany({ take: 50 }),
    documents: await prisma.document.findMany({ take: 50 }),
    auditLogs: await prisma.auditLog.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
  };
  writeFileSync(join(dir, "samples-before.json"), JSON.stringify(samples, null, 2), "utf8");
  writeFileSync(
    join(dir, "README.txt"),
    [
      "WEGO business-data reset backup",
      `createdAt: ${new Date().toISOString()}`,
      "",
      "This is a count + sample export, not a full binary DB dump.",
      "Prefer restoring from a Supabase/Postgres backup if you need full recovery.",
      "",
      "Master data (users, permissions, zones, locations, payment methods, expense types)",
      "was intentionally NOT deleted.",
    ].join("\n"),
    "utf8",
  );
}

type Tx = Prisma.TransactionClient;

async function wipeBusinessData(tx: Tx): Promise<Counts> {
  const deleted: Counts = {};

  const del = async (label: string, fn: () => Promise<{ count: number }>) => {
    deleted[label] = (await fn()).count;
  };

  // Payments children → payments
  await del("PaymentCheck", () => tx.paymentCheck.deleteMany());
  await del("PaymentMethodAllocation", () => tx.paymentMethodAllocation.deleteMany());
  await del("PaymentCashAuditReview", () => tx.paymentCashAuditReview.deleteMany());
  await del("PaymentAdjustmentFee", () => tx.paymentAdjustmentFee.deleteMany());
  await del("ApprovalRequest", () => tx.approvalRequest.deleteMany());
  await del("OrderPaymentBreakdown", () => tx.orderPaymentBreakdown.deleteMany());
  await del("PaymentPlan", () => tx.paymentPlan.deleteMany());
  await del("Payment", () => tx.payment.deleteMany());

  // Orders
  await del("OrderEditRequest", () => tx.orderEditRequest.deleteMany());
  await del("Order", () => tx.order.deleteMany());
  await del("OrderWeekCounter", () => tx.orderWeekCounter.deleteMany());

  // Customers
  await del("ReceiptControl", () => tx.receiptControl.deleteMany());
  await del("CustomerBalanceStatusOverride", () => tx.customerBalanceStatusOverride.deleteMany());
  await del("Customer", () => tx.customer.deleteMany());

  // Cash / flow operational
  await del("CashExpense", () => tx.cashExpense.deleteMany());
  await del("CashCount", () => tx.cashCount.deleteMany());
  await del("CashDailyDrawerCount", () => tx.cashDailyDrawerCount.deleteMany());
  await del("TurkeyTransferMovement", () => tx.turkeyTransferMovement.deleteMany());
  await del("CashWeekFlow", () => tx.cashWeekFlow.deleteMany());

  // Imports / notifications / legacy
  await del("ExcelImportRow", () => tx.excelImportRow.deleteMany());
  await del("ExcelImportFile", () => tx.excelImportFile.deleteMany());
  await del("ManualImportRow", () => tx.manualImportRow.deleteMany());
  await del("ManualImport", () => tx.manualImport.deleteMany());
  await del("LegacyRawRow", () => tx.legacyRawRow.deleteMany());
  await del("UserNotification", () => tx.userNotification.deleteMany());

  // Shipments (children first — several FKs lack onDelete: Cascade)
  await del("ShipmentPaymentLine", () => tx.shipmentPaymentLine.deleteMany());
  await del("ShipmentRecordExpense", () => tx.shipmentRecordExpense.deleteMany());
  await del("ShipmentRecord", () => tx.shipmentRecord.deleteMany());
  await del("ShipmentBatchExpense", () => tx.shipmentBatchExpense.deleteMany());
  await del("ShipmentCashExpense", () => tx.shipmentCashExpense.deleteMany());
  await del("ShipmentCashCount", () => tx.shipmentCashCount.deleteMany());
  await del("ShipmentCashDay", () => tx.shipmentCashDay.deleteMany());
  await del("ShipmentBatch", () => tx.shipmentBatch.deleteMany());
  await del("ManualShipment", () => tx.manualShipment.deleteMany());
  await del("DeliveryLocationAudit", () => tx.deliveryLocationAudit.deleteMany());

  // Documents / inventory counts / audit (approved for full wipe)
  await del("Document", () => tx.document.deleteMany());
  await del("InventoryCountLine", () => tx.inventoryCountLine.deleteMany());
  await del("InventoryCount", () => tx.inventoryCount.deleteMany());
  await del("AuditLog", () => tx.auditLog.deleteMany());

  return deleted;
}

function assertBusinessZeros(business: Counts): string[] {
  const failures: string[] = [];
  for (const key of BUSINESS_COUNT_KEYS) {
    if ((business[key] ?? 0) !== 0) {
      failures.push(`${key}=${business[key]}`);
    }
  }
  return failures;
}

async function checkOrphans(): Promise<string[]> {
  const issues: string[] = [];

  const checks: Array<{ label: string; sql: string }> = [
    {
      label: "Payment.customerId missing Customer",
      sql: `SELECT COUNT(*)::int AS c FROM "Payment" p WHERE p."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Customer" c WHERE c.id = p."customerId")`,
    },
    {
      label: "Payment.orderId missing Order",
      sql: `SELECT COUNT(*)::int AS c FROM "Payment" p WHERE p."orderId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = p."orderId")`,
    },
    {
      label: "payment_method_allocation missing Payment",
      sql: `SELECT COUNT(*)::int AS c FROM "payment_method_allocation" a WHERE NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p.id = a."paymentId")`,
    },
    {
      label: "payment_plan missing Order/Customer",
      sql: `SELECT COUNT(*)::int AS c FROM "payment_plan" pp WHERE NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = pp.order_id) OR NOT EXISTS (SELECT 1 FROM "Customer" c WHERE c.id = pp.customer_id)`,
    },
    {
      label: "ShipmentRecord missing batch",
      sql: `SELECT COUNT(*)::int AS c FROM "ShipmentRecord" r WHERE NOT EXISTS (SELECT 1 FROM "ShipmentBatch" b WHERE b.id = r."batchId")`,
    },
    {
      label: "ShipmentPaymentLine missing record",
      sql: `SELECT COUNT(*)::int AS c FROM "ShipmentPaymentLine" l WHERE NOT EXISTS (SELECT 1 FROM "ShipmentRecord" r WHERE r.id = l."shipmentRecordId")`,
    },
    {
      label: "ShipmentBatchExpense missing batch",
      sql: `SELECT COUNT(*)::int AS c FROM "ShipmentBatchExpense" e WHERE NOT EXISTS (SELECT 1 FROM "ShipmentBatch" b WHERE b.id = e."batchId")`,
    },
    {
      label: "OrderPaymentBreakdown missing Order",
      sql: `SELECT COUNT(*)::int AS c FROM "OrderPaymentBreakdown" b WHERE NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = b."orderId")`,
    },
  ];

  for (const check of checks) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(check.sql);
      const c = Number(rows[0]?.c ?? 0);
      if (c > 0) issues.push(`${check.label}: ${c}`);
    } catch (e) {
      issues.push(`${check.label}: query failed (${e instanceof Error ? e.message : e})`);
    }
  }

  return issues;
}

async function smokeTest(): Promise<{
  ok: boolean;
  ids: { customerId: string; orderId: string; paymentId: string; batchId: string; recordId: string };
  error?: string;
}> {
  const customer = await prisma.customer.create({
    data: {
      displayName: "SMOKE TEST CUSTOMER",
      customerCode: "SMOKE-001",
      countryCode: "TR",
      isActive: true,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: "SMOKE-ORD-001",
      customerId: customer.id,
      countryCode: "TR",
      weekCode: "AH-SMOKE",
      status: "OPEN",
      amountUsd: 10,
      totalUsd: 10,
      isActive: true,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      paymentCode: "SMOKE-PAY-001",
      paymentNumber: 1,
      customerId: customer.id,
      orderId: order.id,
      countryCode: "TR",
      weekCode: "AH-SMOKE",
      currency: "USD",
      amountUsd: 10,
      isPaid: true,
      status: "ACTIVE",
      businessType: "STANDARD",
    },
  });

  const batch = await prisma.shipmentBatch.create({
    data: {
      countryCode: "TR",
      batchNumber: "SMOKE-SHP-001",
      containerNumber: "SMOKE-CTR-001",
      notes: "smoke test",
    },
  });

  const record = await prisma.shipmentRecord.create({
    data: {
      batchId: batch.id,
      rowIndex: 1,
      customerCode: "SMOKE-001",
      customerName: "SMOKE TEST CUSTOMER",
      status: "NEW",
      paymentStatus: "UNPAID",
    },
  });

  const ok =
    (await prisma.customer.count({ where: { id: customer.id } })) === 1 &&
    (await prisma.order.count({ where: { id: order.id } })) === 1 &&
    (await prisma.payment.count({ where: { id: payment.id } })) === 1 &&
    (await prisma.shipmentBatch.count({ where: { id: batch.id } })) === 1 &&
    (await prisma.shipmentRecord.count({ where: { id: record.id } })) === 1;

  return {
    ok,
    ids: {
      customerId: customer.id,
      orderId: order.id,
      paymentId: payment.id,
      batchId: batch.id,
      recordId: record.id,
    },
    error: ok ? undefined : "smoke rows missing after create",
  };
}

async function main() {
  const confirmation = readConfirmArg();
  if (confirmation !== CONFIRM_PHRASE) {
    console.error(`Refusing to run. Pass: --confirm "${CONFIRM_PHRASE}"`);
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(process.cwd(), ".tmp-business-reset-backup", stamp);

  console.log("=== WEGO BUSINESS DATA RESET ===");
  console.log(`backupDir: ${backupDir}`);

  const before = await countAll();
  console.log("\nCounts BEFORE:");
  console.table(before.business);
  console.log("Keep (must survive):");
  console.table(before.keep);

  await writeBackup(backupDir, before);
  console.log("Backup written.");

  const deleted = await prisma.$transaction(
    async (tx) => wipeBusinessData(tx),
    { maxWait: 30_000, timeout: 300_000 },
  );

  const deletedTotal = Object.values(deleted).reduce((a, b) => a + b, 0);
  console.log(`\nDeleted ${deletedTotal} rows:`);
  console.table(deleted);

  writeFileSync(join(backupDir, "deleted-counts.json"), JSON.stringify(deleted, null, 2), "utf8");

  const afterWipe = await countAll();
  const wipeFailures = assertBusinessZeros(afterWipe.business);
  if (wipeFailures.length > 0) {
    console.error("RESET INCOMPLETE — non-zero business tables:", wipeFailures.join(", "));
    writeFileSync(
      join(backupDir, "verify-failed.json"),
      JSON.stringify({ afterWipe, wipeFailures }, null, 2),
      "utf8",
    );
    process.exitCode = 1;
    return;
  }

  const orphansAfterWipe = await checkOrphans();
  if (orphansAfterWipe.length > 0) {
    console.error("Orphan check failed after wipe:", orphansAfterWipe);
    process.exitCode = 1;
    return;
  }

  console.log("\nVerification after wipe: ALL BUSINESS TABLES = 0");
  console.log("Orphan check: PASS");

  // Master data sanity
  if (afterWipe.keep.User < 1) {
    console.error("CRITICAL: User count is 0 after wipe — aborting further steps");
    process.exitCode = 1;
    return;
  }
  console.log(`Keep check: User=${afterWipe.keep.User}, Permission=${afterWipe.keep.Permission}`);

  let smokeResult: {
    ran: boolean;
    ok: boolean;
    wiped: boolean;
    error?: string;
  } = { ran: false, ok: false, wiped: false };

  if (!hasFlag("--skip-smoke")) {
    console.log("\n=== SMOKE TEST ===");
    try {
      const smoke = await smokeTest();
      smokeResult.ran = true;
      smokeResult.ok = smoke.ok;
      if (!smoke.ok) {
        console.error("Smoke create/verify FAILED:", smoke.error);
        process.exitCode = 1;
        return;
      }
      console.log("Smoke create OK:", smoke.ids);

      const smokeWipe = await prisma.$transaction(
        async (tx) => wipeBusinessData(tx),
        { maxWait: 30_000, timeout: 300_000 },
      );
      console.log("Smoke wipe deleted:", Object.values(smokeWipe).reduce((a, b) => a + b, 0), "rows");
      smokeResult.wiped = true;

      const afterSmoke = await countAll();
      const smokeFailures = assertBusinessZeros(afterSmoke.business);
      if (smokeFailures.length > 0) {
        console.error("Smoke wipe incomplete:", smokeFailures.join(", "));
        process.exitCode = 1;
        return;
      }
      console.log("Smoke wiped — business tables back to 0");
    } catch (e) {
      smokeResult.error = e instanceof Error ? e.message : String(e);
      console.error("Smoke test error:", smokeResult.error);
      process.exitCode = 1;
      return;
    }
  }

  const finalCounts = await countAll();
  const report = {
    completedAt: new Date().toISOString(),
    backupDir,
    deleted,
    deletedTotal,
    countsAfter: {
      Customers: finalCounts.business.Customer,
      Orders: finalCounts.business.Order,
      OrderItems: 0, // no OrderItem model in schema
      Payments: finalCounts.business.Payment,
      PaymentAllocations_PaymentMethodAllocation: finalCounts.business.PaymentMethodAllocation,
      PaymentSplits_PaymentMethodAllocation: finalCounts.business.PaymentMethodAllocation,
      OrderPaymentBreakdown: finalCounts.business.OrderPaymentBreakdown,
      Shipments_ShipmentBatch: finalCounts.business.ShipmentBatch,
      ShipmentItems_ShipmentRecord: finalCounts.business.ShipmentRecord,
      Containers_ShipmentBatch: finalCounts.business.ShipmentBatch,
      ManualShipment: finalCounts.business.ManualShipment,
      ShipmentExpenses_Batch: finalCounts.business.ShipmentBatchExpense,
      ShipmentExpenses_Record: finalCounts.business.ShipmentRecordExpense,
      CashWeekFlow: finalCounts.business.CashWeekFlow,
      Document: finalCounts.business.Document,
      AuditLog: finalCounts.business.AuditLog,
    },
    keepAfter: finalCounts.keep,
    orphanCheck: "PASS",
    smoke: smokeResult,
    cacheNote:
      "Next.js unstable_cache tags (dashboard/customers/orders KPIs) live in the Next process. Restart `next dev` / redeploy so UI KPIs show 0 immediately.",
    reviewDecisions: {
      Document: "DELETED (all)",
      AuditLog: "DELETED (all, including USER_LOGIN — clean slate)",
      InventoryCount: "DELETED if any (was 0)",
    },
  };

  writeFileSync(join(backupDir, "reset-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== FINAL REPORT ===");
  console.log(JSON.stringify(report, null, 2));
  console.log("\nRESET COMPLETE. Restart the Next.js server so cached KPIs refresh to 0.");
}

main()
  .catch((e) => {
    console.error("reset-business-data failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
