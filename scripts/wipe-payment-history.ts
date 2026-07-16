/**
 * Full DB backup (custom format via pg_dump if available, else JSON dump of all public tables),
 * then wipe customer payment history only — no DROP, no customer/order/settings deletion.
 *
 * Run: npx tsx scripts/wipe-payment-history.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
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
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  const manifest: Record<string, number> = {};
  for (const { tablename } of tables) {
    // Identifier only from pg_tables — safe to interpolate after validate
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tablename)) {
      throw new Error(`Unsafe table name: ${tablename}`);
    }
    const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${tablename}"`);
    const file = path.join(outDir, `${tablename}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
    manifest[tablename] = rows.length;
    console.log(`  backed up ${tablename}: ${rows.length} rows`);
  }
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return outDir;
}

async function count(table: string): Promise<number> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`bad table ${table}`);
  const r = await prisma.$queryRawUnsafe<[{ c: bigint }]>(`SELECT COUNT(*)::bigint AS c FROM "${table}"`);
  return Number(r[0]?.c ?? 0);
}

async function main() {
  loadEnvLocal();
  const direct = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!direct) throw new Error("Missing DIRECT_URL / DATABASE_URL");

  const ts = stamp();
  const backupRoot = path.join(process.cwd(), "backups", `full-db-${ts}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  console.log(`\n=== BACKUP → ${backupRoot} ===\n`);

  const pgDump = findPgDump();
  let pgDumpFile: string | null = null;
  if (pgDump) {
    pgDumpFile = path.join(backupRoot, `wego-full-${ts}.dump`);
    console.log(`Running pg_dump (${pgDump})…`);
    try {
      execFileSync(
        pgDump,
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--file=${pgDumpFile}`,
          direct,
        ],
        { stdio: "inherit", env: process.env },
      );
      console.log(`pg_dump OK: ${pgDumpFile}`);
    } catch (e) {
      console.warn("pg_dump failed — continuing with JSON backup only:", e);
      pgDumpFile = null;
    }
  } else {
    console.warn("pg_dump not found — creating full JSON table dump instead.");
  }

  console.log("\nJSON dump of all public tables…");
  await jsonBackupAllTables(backupRoot);

  // Pre-counts
  const tables = [
    "PaymentAdjustmentFee",
    "PaymentCheck",
    "PaymentCashAuditReview",
    "ApprovalRequest",
    "Payment",
    "ReceiptControl",
  ] as const;

  const before: Record<string, number> = {};
  for (const t of tables) before[t] = await count(t);
  before["PaymentPlan_COMPLETED"] = Number(
    (
      await prisma.$queryRaw<[{ c: bigint }]>`
        SELECT COUNT(*)::bigint AS c FROM payment_plan WHERE status = 'COMPLETED'
      `
    )[0]?.c ?? 0,
  );
  before["Customer_nonzero_balance"] = Number(
    (
      await prisma.$queryRaw<[{ c: bigint }]>`
        SELECT COUNT(*)::bigint AS c FROM "Customer" WHERE "balanceUsd" <> 0
      `
    )[0]?.c ?? 0,
  );
  before["AuditLog_payment_related"] = Number(
    (
      await prisma.$queryRaw<[{ c: bigint }]>`
        SELECT COUNT(*)::bigint AS c FROM "AuditLog"
        WHERE "entityType" IN ('Payment', 'PaymentAdjustmentFee', 'PaymentCheck')
           OR "actionType" ILIKE '%PAYMENT%'
           OR "actionType" ILIKE '%CREDIT%'
           OR "actionType" ILIKE '%BALANCE_RESET%'
      `
    )[0]?.c ?? 0,
  );

  console.log("\n=== COUNTS BEFORE ===");
  console.log(before);

  console.log("\n=== WIPING PAYMENT HISTORY (transaction) ===\n");

  const deleted: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      // 1) Dependents that may not cascade when paymentId is null
      deleted.PaymentAdjustmentFee = (
        await tx.paymentAdjustmentFee.deleteMany({})
      ).count;

      deleted.PaymentCheck = (await tx.paymentCheck.deleteMany({})).count;
      deleted.PaymentCashAuditReview = (await tx.paymentCashAuditReview.deleteMany({})).count;
      deleted.ApprovalRequest = (await tx.approvalRequest.deleteMany({})).count;

      // 2) Core payments
      deleted.Payment = (await tx.payment.deleteMany({})).count;

      // 3) Receipt control history (customer receipt intake tracking)
      deleted.ReceiptControl = (await tx.receiptControl.deleteMany({})).count;

      // 4) Reset payment-plan closure state (keep plans + OrderPaymentBreakdown — order document design)
      const plansReset = await tx.paymentPlan.updateMany({
        where: {
          OR: [
            { status: { in: ["COMPLETED", "PARTIALLY_RECEIVED"] } },
            { closureType: { not: null } },
          ],
        },
        data: { status: "ACTIVE", closureType: null },
      });
      deleted.PaymentPlan_resetToActive = plansReset.count;

      // 5) Payment-related audit trail
      const auditDel = await tx.$executeRaw`
        DELETE FROM "AuditLog"
        WHERE "entityType" IN ('Payment', 'PaymentAdjustmentFee', 'PaymentCheck')
           OR "actionType" ILIKE '%PAYMENT%'
           OR "actionType" ILIKE '%CREDIT%'
           OR "actionType" ILIKE '%BALANCE_RESET%'
           OR "actionType" ILIKE '%SURPLUS%'
      `;
      deleted.AuditLog_payment_related = Number(auditDel);

      // 6) Recalc Customer.balanceUsd = payments(0) + withdrawals − orders
      //    (same convention as getCustomerOpenDebt.internalSignedUsd)
      await tx.$executeRaw`
        UPDATE "Customer" c
        SET "balanceUsd" = COALESCE((
          SELECT ROUND((
            COALESCE((
              SELECT SUM(COALESCE(w."debtWithdrawalUsd", COALESCE(w."totalUsd", COALESCE(w."amountUsd", 0) + COALESCE(w."commissionUsd", 0))))
              FROM "Order" w
              WHERE w."customerId" = c.id
                AND w."deletedAt" IS NULL
                AND w."status" = 'DEBT_WITHDRAWAL'
            ), 0)
            -
            COALESCE((
              SELECT SUM(COALESCE(o."totalUsd", COALESCE(o."amountUsd", 0) + COALESCE(o."commissionUsd", 0)))
              FROM "Order" o
              WHERE o."customerId" = c.id
                AND o."deletedAt" IS NULL
                AND o."status" <> 'DEBT_WITHDRAWAL'
                AND o."status" <> 'CANCELLED'
            ), 0)
          )::numeric, 4)
        ), 0)
      `;
      deleted.Customer_balancesRecalculated = (
        await tx.customer.count({ where: { deletedAt: null } })
      );
    },
    { timeout: 600_000, maxWait: 60_000 },
  );

  console.log("\n=== DELETED / UPDATED ===");
  console.log(deleted);

  // Integrity checks
  const after: Record<string, number> = {};
  for (const t of tables) after[t] = await count(t);

  const orphanChecks = {
    PaymentCheck_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "PaymentCheck" pc
          LEFT JOIN "Payment" p ON p.id = pc."paymentId"
          WHERE p.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    PaymentCashAuditReview_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "PaymentCashAuditReview" r
          LEFT JOIN "Payment" p ON p.id = r."paymentId"
          WHERE p.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    ApprovalRequest_orphan: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "ApprovalRequest" a
          LEFT JOIN "Payment" p ON p.id = a."paymentId"
          WHERE p.id IS NULL
        `
      )[0]?.c ?? 0,
    ),
    PaymentAdjustmentFee_with_paymentId: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM "PaymentAdjustmentFee"
          WHERE "paymentId" IS NOT NULL
        `
      )[0]?.c ?? 0,
    ),
    Payment_remaining: after.Payment,
    PaymentPlan_COMPLETED: Number(
      (
        await prisma.$queryRaw<[{ c: bigint }]>`
          SELECT COUNT(*)::bigint AS c FROM payment_plan WHERE status = 'COMPLETED'
        `
      )[0]?.c ?? 0,
    ),
  };

  // Sample: orders still have totals; paid sums should be 0
  const samplePaid = await prisma.$queryRaw<
    { orderNumber: string | null; totalUsd: Prisma.Decimal | null; paid: Prisma.Decimal }[]
  >`
    SELECT o."orderNumber", o."totalUsd",
           COALESCE((
             SELECT SUM(p."amountUsd") FROM "Payment" p
             WHERE p."orderId" = o.id AND p."isPaid" = TRUE
               AND (p."status" IS NULL OR p."status" <> 'CANCELLED')
           ), 0) AS paid
    FROM "Order" o
    WHERE o."deletedAt" IS NULL
      AND o."orderNumber" = 'TR-131-0001'
    LIMIT 1
  `;

  const customersKept = await prisma.customer.count({ where: { deletedAt: null } });
  const ordersKept = await prisma.order.count({ where: { deletedAt: null } });

  const report = {
    backupDir: backupRoot,
    pgDumpFile,
    before,
    deleted,
    after,
    orphanChecks,
    preserved: {
      customers: customersKept,
      orders: ordersKept,
      OrderPaymentBreakdown: await count("OrderPaymentBreakdown"),
      PaymentPlan: Number(
        (
          await prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*)::bigint AS c FROM payment_plan`
        )[0]?.c ?? 0,
      ),
      PaymentPoint: await count("PaymentPoint"),
      PaymentLocation: await count("PaymentLocation"),
      SourcePaymentMethod: await count("SourcePaymentMethod"),
      PaymentMethodRegistry: await count("PaymentMethodRegistry"),
      Document: await count("Document"),
      User: await count("User"),
    },
    sample_TR_131_0001: samplePaid[0]
      ? {
          orderNumber: samplePaid[0].orderNumber,
          totalUsd: samplePaid[0].totalUsd?.toString() ?? null,
          paidFromPayments: samplePaid[0].paid?.toString?.() ?? String(samplePaid[0].paid),
        }
      : null,
    ok:
      after.Payment === 0 &&
      after.PaymentCheck === 0 &&
      after.PaymentAdjustmentFee === 0 &&
      after.ApprovalRequest === 0 &&
      after.PaymentCashAuditReview === 0 &&
      orphanChecks.PaymentCheck_orphan === 0 &&
      orphanChecks.ApprovalRequest_orphan === 0 &&
      orphanChecks.PaymentCashAuditReview_orphan === 0,
  };

  fs.writeFileSync(path.join(backupRoot, "wipe-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== FINAL REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
