/**
 * Client handover — full transactional data wipe with backup + integrity checks.
 *
 * Usage:
 *   tsx scripts/client-handover-clean.ts              # audit only
 *   tsx scripts/client-handover-clean.ts --backup     # backup only
 *   tsx scripts/client-handover-clean.ts --execute --confirm "CLIENT HANDOVER CLEAN"
 *   tsx scripts/client-handover-clean.ts --verify     # post-clean integrity
 *   tsx scripts/client-handover-clean.ts --smoke-test # create + delete test scenario
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const CONFIRMATION = "CLIENT HANDOVER CLEAN";
const prisma = new PrismaClient();

/** Tables wiped (transactional). Keys match Prisma delegate names where possible. */
const WIPE_TARGETS = [
  "document",
  "turkeyTransferMovement",
  "paymentAdjustmentFee",
  "paymentMethodAllocation",
  "paymentCashAuditReview",
  "paymentCheck",
  "approvalRequest",
  "payment",
  "cashExpense",
  "cashCount",
  "cashDailyDrawerCount",
  "cashWeekFlow",
  "receiptControl",
  "orderEditRequest",
  "paymentPlan",
  "orderPaymentBreakdown",
  "order",
  "orderWeekCounter",
  "customerBalanceStatusOverride",
  "customer",
  "shipmentCashCount",
  "shipmentCashExpense",
  "shipmentCashDay",
  "shipmentPaymentLine",
  "shipmentRecordExpense",
  "deliveryLocationAudit",
  "shipmentRecord",
  "shipmentBatchExpense",
  "shipmentBatch",
  "manualImportRow",
  "manualImport",
  "excelImportRow",
  "excelImportFile",
  "manualShipment",
  "inventoryCountLine",
  "inventoryCount",
  "userNotification",
  "auditLog",
  "legacyRawRow",
] as const;

const PRESERVED = [
  "User / Permission / UserPermission",
  "FinancialSettings / AdminSystemSettings",
  "SourceStatus / SourcePaymentMethod / PaymentMethodRegistry",
  "PaymentPoint / PaymentLocation / IntakeLocation / OrderLocation",
  "ShipmentCourier / ShipmentDeliveryZone / DeliveryLocation / DeliveryLocationAlias",
  "InventoryItem (catalog)",
  "ArabicDisplayNameCache",
];

type CountMap = Record<string, number>;

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function findPgDump(): string | null {
  const candidates = [
    process.env.PG_DUMP_PATH,
    "pg_dump",
    "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
    "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
    "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (c === "pg_dump") {
        execFileSync(c, ["--version"], { stdio: "pipe" });
        return c;
      }
      if (fs.existsSync(c)) return c;
    } catch {
      /* continue */
    }
  }
  return null;
}

async function jsonBackupAllTables(backupDir: string): Promise<string> {
  const outDir = path.join(backupDir, "json-tables");
  fs.mkdirSync(outDir, { recursive: true });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const manifest: Record<string, number> = {};
  for (const { tablename } of tables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tablename)) {
      throw new Error(`Unsafe table name: ${tablename}`);
    }
    const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${tablename}"`);
    fs.writeFileSync(path.join(outDir, `${tablename}.json`), JSON.stringify(rows, null, 2), "utf8");
    manifest[tablename] = rows.length;
    console.log(`  backed up ${tablename}: ${rows.length} rows`);
  }
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return outDir;
}

async function createFullBackup(): Promise<string> {
  loadEnvLocal();
  const direct = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!direct) throw new Error("Missing DIRECT_URL / DATABASE_URL");

  const backupRoot = path.join(process.cwd(), "backups", `client-handover-${stamp()}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  console.log(`\n=== BACKUP → ${backupRoot} ===\n`);

  const pgDump = findPgDump();
  if (pgDump) {
    const pgDumpFile = path.join(backupRoot, `wego-handover-${stamp()}.dump`);
    try {
      execFileSync(
        pgDump,
        ["--format=custom", "--no-owner", "--no-acl", `--file=${pgDumpFile}`, direct],
        { stdio: "inherit", env: process.env },
      );
      console.log(`pg_dump OK: ${pgDumpFile}`);
    } catch (e) {
      console.warn("pg_dump failed — continuing with JSON backup only:", e);
    }
  } else {
    console.warn("pg_dump not found — JSON backup only.");
  }

  console.log("\nJSON dump of all public tables…");
  await jsonBackupAllTables(backupRoot);
  fs.writeFileSync(
    path.join(backupRoot, "README.txt"),
    [
      "Client handover backup",
      `Created: ${new Date().toISOString()}`,
      "Contains pg_dump (if available) + json-tables/*.json + manifest.json",
      "Restore: pg_restore --clean --no-owner --no-acl -d <db> wego-handover-*.dump",
    ].join("\n"),
    "utf8",
  );
  return backupRoot;
}

async function countDelegate(key: string): Promise<number> {
  const delegate = (prisma as Record<string, { count?: () => Promise<number> }>)[key];
  if (delegate?.count) return delegate.count();
  return 0;
}

async function auditCounts(): Promise<CountMap> {
  const counts: CountMap = {};
  for (const key of WIPE_TARGETS) {
    counts[key] = await countDelegate(key);
  }
  counts.users = await prisma.user.count();
  counts.financialSettings = await prisma.financialSettings.count();
  counts.sourceStatus = await prisma.sourceStatus.count();
  counts.shipmentCouriers = await prisma.shipmentCourier.count();
  counts.deliveryLocations = await prisma.deliveryLocation.count();
  counts.inventoryItems = await prisma.inventoryItem.count();
  counts.customerBalanceNonZero = Number(
    (
      await prisma.$queryRaw<[{ c: bigint }]>`
        SELECT COUNT(*)::bigint AS c FROM "Customer" WHERE "balanceUsd" <> 0
      `
    )[0]?.c ?? 0,
  );
  return counts;
}

async function deleteDocuments(tx: Prisma.TransactionClient): Promise<number> {
  const r = await tx.$executeRaw`
    DELETE FROM "Document"
    WHERE "entityType" IN ('ORDER', 'PAYMENT', 'CUSTOMER', 'REPORT', 'SHIPMENT')
       OR "deletedAt" IS NOT NULL
  `;
  return Number(r);
}

async function executeClean(): Promise<{ deleted: CountMap; backupPath: string }> {
  const before = await auditCounts();
  console.log("\n=== PRE-CLEAN AUDIT ===");
  console.table(before);

  const backupPath = await createFullBackup();

  console.log("\n=== EXECUTING CLEAN (transaction) ===\n");
  const deleted: CountMap = {};

  await prisma.$transaction(
    async (tx) => {
      deleted.document = await deleteDocuments(tx);

      deleted.turkeyTransferMovement = (await tx.turkeyTransferMovement.deleteMany()).count;
      deleted.paymentAdjustmentFee = (await tx.paymentAdjustmentFee.deleteMany()).count;
      deleted.paymentMethodAllocation = (await tx.paymentMethodAllocation.deleteMany()).count;
      deleted.paymentCashAuditReview = (await tx.paymentCashAuditReview.deleteMany()).count;
      deleted.paymentCheck = (await tx.paymentCheck.deleteMany()).count;
      deleted.approvalRequest = (await tx.approvalRequest.deleteMany()).count;
      deleted.payment = (await tx.payment.deleteMany()).count;

      deleted.cashExpense = (await tx.cashExpense.deleteMany()).count;
      deleted.cashCount = (await tx.cashCount.deleteMany()).count;
      deleted.cashDailyDrawerCount = (await tx.cashDailyDrawerCount.deleteMany()).count;
      deleted.cashWeekFlow = (await tx.cashWeekFlow.deleteMany()).count;
      deleted.receiptControl = (await tx.receiptControl.deleteMany()).count;

      deleted.orderEditRequest = (await tx.orderEditRequest.deleteMany()).count;
      deleted.paymentPlan = (await tx.paymentPlan.deleteMany()).count;
      deleted.orderPaymentBreakdown = (await tx.orderPaymentBreakdown.deleteMany()).count;
      deleted.order = (await tx.order.deleteMany()).count;
      deleted.orderWeekCounter = (await tx.orderWeekCounter.deleteMany()).count;
      deleted.customerBalanceStatusOverride = (
        await tx.customerBalanceStatusOverride.deleteMany()
      ).count;
      deleted.customer = (await tx.customer.deleteMany()).count;

      deleted.shipmentCashCount = (await tx.shipmentCashCount.deleteMany()).count;
      deleted.shipmentCashExpense = (await tx.shipmentCashExpense.deleteMany()).count;
      deleted.shipmentCashDay = (await tx.shipmentCashDay.deleteMany()).count;
      deleted.shipmentPaymentLine = (await tx.shipmentPaymentLine.deleteMany()).count;
      deleted.shipmentRecordExpense = (await tx.shipmentRecordExpense.deleteMany()).count;
      deleted.deliveryLocationAudit = (await tx.deliveryLocationAudit.deleteMany()).count;
      deleted.shipmentRecord = (await tx.shipmentRecord.deleteMany()).count;
      deleted.shipmentBatchExpense = (await tx.shipmentBatchExpense.deleteMany()).count;
      deleted.shipmentBatch = (await tx.shipmentBatch.deleteMany()).count;

      deleted.manualImportRow = (await tx.manualImportRow.deleteMany()).count;
      deleted.manualImport = (await tx.manualImport.deleteMany()).count;
      deleted.excelImportRow = (await tx.excelImportRow.deleteMany()).count;
      deleted.excelImportFile = (await tx.excelImportFile.deleteMany()).count;
      deleted.manualShipment = (await tx.manualShipment.deleteMany()).count;

      deleted.inventoryCountLine = (await tx.inventoryCountLine.deleteMany()).count;
      deleted.inventoryCount = (await tx.inventoryCount.deleteMany()).count;
      deleted.userNotification = (await tx.userNotification.deleteMany()).count;
      deleted.auditLog = (await tx.auditLog.deleteMany()).count;
      deleted.legacyRawRow = (await tx.legacyRawRow.deleteMany()).count;
    },
    { timeout: 600_000, maxWait: 60_000 },
  );

  return { deleted, backupPath };
}

async function verifyIntegrity(): Promise<Record<string, number | boolean>> {
  const finalCounts = {
    customers: await prisma.customer.count(),
    orders: await prisma.order.count(),
    payments: await prisma.payment.count(),
    shipmentBatches: await prisma.shipmentBatch.count(),
    shipmentRecords: await prisma.shipmentRecord.count(),
    customerBalanceNonZero: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "Customer" WHERE "balanceUsd" <> 0
        `
      )[0]?.c ?? 0,
    ),
  };

  const orphans = {
    paymentCheck_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "PaymentCheck" pc
          LEFT JOIN "Payment" p ON p.id = pc."paymentId" WHERE p.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    payment_orphan_order: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "Payment" p
          LEFT JOIN "Order" o ON o.id = p."orderId"
          WHERE p."orderId" IS NOT NULL AND o.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    payment_orphan_customer: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "Payment" p
          LEFT JOIN "Customer" c ON c.id = p."customerId"
          WHERE p."customerId" IS NOT NULL AND c.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    shipmentPayment_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "ShipmentPaymentLine" spl
          LEFT JOIN "ShipmentRecord" sr ON sr.id = spl."shipmentRecordId"
          WHERE sr.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    shipmentExpense_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "ShipmentRecordExpense" e
          LEFT JOIN "ShipmentRecord" sr ON sr.id = e."shipmentRecordId"
          WHERE sr.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    order_orphan_customer: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "Order" o
          LEFT JOIN "Customer" c ON c.id = o."customerId"
          WHERE o."customerId" IS NOT NULL AND c.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
  };

  return { ...finalCounts, ...orphans };
}

async function smokeTest(): Promise<{ ok: boolean; ids: Record<string, string>; cleaned: boolean }> {
  const ids: Record<string, string> = {};
  const weekCode = "2099-W01";

  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        displayName: "SMOKE TEST CLIENT",
        customerCode: "SMOKE-001",
        countryCode: "TR",
        balanceUsd: new Prisma.Decimal(0),
      },
    });
    ids.customerId = customer.id;

    const order = await tx.order.create({
      data: {
        customerId: customer.id,
        orderNumber: `SMOKE-TR-${Date.now()}`,
        countryCode: "TR",
        weekCode,
        status: "OPEN",
        amountUsd: new Prisma.Decimal(100),
        commissionUsd: new Prisma.Decimal(20),
        totalUsd: new Prisma.Decimal(120),
        paymentMethod: "CASH",
      },
    });
    ids.orderId = order.id;

    const payment = await tx.payment.create({
      data: {
        customerId: customer.id,
        orderId: order.id,
        countryCode: "TR",
        weekCode,
        amountUsd: new Prisma.Decimal(120),
        paymentMethod: "CASH",
        status: "ACTIVE",
        isPaid: true,
      },
    });
    ids.paymentId = payment.id;

    const batch = await tx.shipmentBatch.create({
      data: {
        countryCode: "TR",
        batchNumber: `SMOKE-SHP-${Date.now()}`,
      },
    });
    ids.batchId = batch.id;

    const record = await tx.shipmentRecord.create({
      data: {
        batchId: batch.id,
        rowIndex: 1,
        customerCode: "SMOKE-001",
        customerName: "SMOKE TEST CLIENT",
        status: "NEW",
        paymentStatus: "PAID",
      },
    });
    ids.recordId = record.id;

    await tx.shipmentPaymentLine.create({
      data: {
        shipmentRecordId: record.id,
        method: "CASH",
        amountIls: new Prisma.Decimal(50),
      },
    });
  });

  const verify = await verifyIntegrity();
  const flowOk =
    verify.customers === 1 &&
    verify.orders === 1 &&
    verify.payments === 1 &&
    verify.shipmentBatches === 1 &&
    verify.shipmentRecords === 1;

  // Clean smoke data
  await prisma.$transaction(async (tx) => {
    await tx.shipmentPaymentLine.deleteMany({ where: { shipmentRecordId: ids.recordId } });
    await tx.shipmentRecord.deleteMany({ where: { id: ids.recordId } });
    await tx.shipmentBatch.deleteMany({ where: { id: ids.batchId } });
    await tx.payment.deleteMany({ where: { id: ids.paymentId } });
    await tx.order.deleteMany({ where: { id: ids.orderId } });
    await tx.customer.deleteMany({ where: { id: ids.customerId } });
  });

  const after = await verifyIntegrity();
  const cleaned =
    after.customers === 0 &&
    after.orders === 0 &&
    after.payments === 0 &&
    after.shipmentBatches === 0 &&
    after.shipmentRecords === 0;

  return { ok: flowOk, ids, cleaned };
}

function readConfirmArg(): string {
  const idx = process.argv.indexOf("--confirm");
  if (idx === -1) return "";
  return process.argv[idx + 1] ?? "";
}

async function main() {
  loadEnvLocal();
  const args = new Set(process.argv.slice(2));
  const execute = args.has("--execute");
  const backupOnly = args.has("--backup");
  const verifyOnly = args.has("--verify");
  const smoke = args.has("--smoke-test");

  if (smoke) {
    console.log("\n=== SMOKE TEST ===\n");
    const result = await smokeTest();
    console.log(result);
    if (!result.ok || !result.cleaned) process.exitCode = 1;
    return;
  }

  if (verifyOnly) {
    console.log("\n=== INTEGRITY / FINAL COUNTS ===\n");
    console.table(await verifyIntegrity());
    return;
  }

  const counts = await auditCounts();
  console.log("\n=== AUDIT — TABLES TO WIPE ===\n");
  console.table(counts);
  console.log("\n=== PRESERVED ===\n");
  for (const p of PRESERVED) console.log(`- ${p}`);

  if (backupOnly) {
    await createFullBackup();
    return;
  }

  if (!execute) {
    console.log("\nDry run. To execute after reviewing audit:");
    console.log(`tsx scripts/client-handover-clean.ts --execute --confirm "${CONFIRMATION}"`);
    return;
  }

  const confirmation = readConfirmArg();
  if (confirmation !== CONFIRMATION) {
    console.error(`Missing/invalid --confirm. Required: "${CONFIRMATION}"`);
    process.exitCode = 1;
    return;
  }

  const { deleted, backupPath } = await executeClean();
  console.log("\n=== DELETED ===");
  console.table(deleted);
  console.log(`\nBackup: ${backupPath}`);

  console.log("\n=== INTEGRITY / FINAL COUNTS ===");
  const integrity = await verifyIntegrity();
  console.table(integrity);

  console.log("\n=== SMOKE TEST (post-clean) ===");
  const smokeResult = await smokeTest();
  console.log(smokeResult);

  const ok =
    integrity.customers === 0 &&
    integrity.orders === 0 &&
    integrity.payments === 0 &&
    integrity.shipmentBatches === 0 &&
    integrity.shipmentRecords === 0 &&
    integrity.customerBalanceNonZero === 0 &&
    Object.entries(integrity)
      .filter(([k]) => k.includes("orphan"))
      .every(([, v]) => v === 0) &&
    smokeResult.ok &&
    smokeResult.cleaned;

  if (!ok) {
    console.error("\nHandover clean completed with issues — review output.");
    process.exitCode = 1;
  } else {
    console.log("\n✓ Client handover clean completed successfully.");
  }
}

main()
  .catch((e) => {
    console.error("client-handover-clean failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
