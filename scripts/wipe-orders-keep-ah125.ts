/**
 * Backup (JSON) then delete all Orders except weekCode = AH-125.
 * Keeps customers, users, settings, catalogs. Cascades plan/breakdown/edit requests.
 * Recalculates Customer.balanceUsd after.
 *
 * Run: npx tsx scripts/wipe-orders-keep-ah125.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const KEEP_WEEK = "AH-125";
const prisma = new PrismaClient();

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

async function jsonBackupAllTables(backupDir: string): Promise<void> {
  const outDir = path.join(backupDir, "json-tables");
  fs.mkdirSync(outDir, { recursive: true });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const manifest: Record<string, number> = {};
  for (const { tablename } of tables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tablename)) throw new Error(tablename);
    const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${tablename}"`);
    fs.writeFileSync(path.join(outDir, `${tablename}.json`), JSON.stringify(rows, null, 2), "utf8");
    manifest[tablename] = rows.length;
    console.log(`  backed up ${tablename}: ${rows.length}`);
  }
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

async function main() {
  loadEnvLocal();
  const ts = stamp();
  const backupRoot = path.join(process.cwd(), "backups", `orders-keep-${KEEP_WEEK}-${ts}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  console.log(`\n=== BACKUP → ${backupRoot} ===\n`);
  await jsonBackupAllTables(backupRoot);

  const beforeByWeek = await prisma.$queryRaw<{ week: string; c: number }[]>`
    SELECT COALESCE("weekCode", '(null)') AS week, COUNT(*)::int AS c
    FROM "Order"
    WHERE "deletedAt" IS NULL
    GROUP BY 1
    ORDER BY 1
  `;
  const keepCount = await prisma.order.count({
    where: { deletedAt: null, weekCode: KEEP_WEEK },
  });
  const deleteCount = await prisma.order.count({
    where: {
      deletedAt: null,
      OR: [{ weekCode: null }, { weekCode: { not: KEEP_WEEK } }],
    },
  });
  const softDeletedAlso = await prisma.order.count({
    where: {
      deletedAt: { not: null },
      OR: [{ weekCode: null }, { weekCode: { not: KEEP_WEEK } }],
    },
  });

  console.log("\n=== BEFORE ===");
  console.log({ beforeByWeek, keepCount, deleteCount, softDeletedAlso });

  if (keepCount === 0) {
    console.warn(`WARNING: no active orders in ${KEEP_WEEK}`);
  }

  // Collect IDs to delete (hard-delete all non-AH-125, including soft-deleted)
  const toDelete = await prisma.order.findMany({
    where: {
      OR: [{ weekCode: null }, { weekCode: { not: KEEP_WEEK } }],
    },
    select: { id: true, orderNumber: true, weekCode: true },
  });
  const ids = toDelete.map((o) => o.id);

  const deleted: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      if (ids.length === 0) {
        deleted.Order = 0;
        return;
      }

      // Children without Cascade / optional FKs first
      deleted.PaymentAdjustmentFee = (
        await tx.paymentAdjustmentFee.deleteMany({ where: { orderId: { in: ids } } })
      ).count;

      // Payments already wiped; still clear any leftovers linked to these orders
      deleted.Payment = (await tx.payment.deleteMany({ where: { orderId: { in: ids } } })).count;

      // Cascades: OrderPaymentBreakdown, PaymentPlan, OrderEditRequest
      deleted.OrderEditRequest = (
        await tx.orderEditRequest.deleteMany({ where: { orderId: { in: ids } } })
      ).count;
      deleted.payment_plan = (
        await tx.paymentPlan.deleteMany({ where: { orderId: { in: ids } } })
      ).count;
      deleted.OrderPaymentBreakdown = (
        await tx.orderPaymentBreakdown.deleteMany({ where: { orderId: { in: ids } } })
      ).count;

      deleted.Order = (await tx.order.deleteMany({ where: { id: { in: ids } } })).count;

      // Soft-delete Document rows linked to removed orders
      if (ids.length > 0) {
        const docResult = await tx.$executeRaw`
          UPDATE "Document"
          SET "deletedAt" = NOW()
          WHERE "entityType" = 'ORDER'
            AND "deletedAt" IS NULL
            AND "entityId" IN (${Prisma.join(ids)})
        `;
        deleted.Document_softDeleted_forRemovedOrders = Number(docResult);
      } else {
        deleted.Document_softDeleted_forRemovedOrders = 0;
      }

      // Recalc balances from remaining orders only (payments already 0)
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
      deleted.Customer_balancesRecalculated = await tx.customer.count({ where: { deletedAt: null } });
    },
    { timeout: 600_000, maxWait: 60_000 },
  );

  const afterByWeek = await prisma.$queryRaw<{ week: string; c: number }[]>`
    SELECT COALESCE("weekCode", '(null)') AS week, COUNT(*)::int AS c
    FROM "Order"
    WHERE "deletedAt" IS NULL
    GROUP BY 1
    ORDER BY 1
  `;
  const remainingOrders = await prisma.order.count();
  const remainingActive = await prisma.order.count({ where: { deletedAt: null } });
  const non125 = await prisma.order.count({
    where: {
      OR: [{ weekCode: null }, { weekCode: { not: KEEP_WEEK } }],
    },
  });

  const report = {
    keepWeek: KEEP_WEEK,
    backupDir: backupRoot,
    beforeByWeek,
    keepCountBefore: keepCount,
    deleted,
    afterByWeek,
    remainingOrdersTotal: remainingOrders,
    remainingActive,
    nonAH125_remaining: non125,
    preserved: {
      customers: await prisma.customer.count({ where: { deletedAt: null } }),
      users: await prisma.user.count(),
      payments: await prisma.payment.count(),
    },
    ok: non125 === 0,
  };

  fs.writeFileSync(path.join(backupRoot, "wipe-orders-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
