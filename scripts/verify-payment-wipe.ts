import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function c(sql: string): Promise<number> {
  const r = await prisma.$queryRawUnsafe<[{ c: bigint }]>(sql);
  return Number(r[0]?.c ?? 0);
}

async function main() {
  const report = {
    deletedEarlier: {
      PaymentAdjustmentFee: 2,
      PaymentCheck: 2,
      PaymentCashAuditReview: 0,
      ApprovalRequest: 1,
      Payment: 35,
      ReceiptControl: 5,
      PaymentPlan_resetToActive: 0,
      AuditLog_payment_related: 42,
      Customer_balancesRecalculated: 92,
    },
    remaining: {
      Payment: await c(`SELECT COUNT(*)::bigint AS c FROM "Payment"`),
      PaymentCheck: await c(`SELECT COUNT(*)::bigint AS c FROM "PaymentCheck"`),
      PaymentAdjustmentFee: await c(`SELECT COUNT(*)::bigint AS c FROM "PaymentAdjustmentFee"`),
      ApprovalRequest: await c(`SELECT COUNT(*)::bigint AS c FROM "ApprovalRequest"`),
      PaymentCashAuditReview: await c(`SELECT COUNT(*)::bigint AS c FROM "PaymentCashAuditReview"`),
      ReceiptControl: await c(`SELECT COUNT(*)::bigint AS c FROM "ReceiptControl"`),
      payment_plan_COMPLETED: await c(
        `SELECT COUNT(*)::bigint AS c FROM payment_plan WHERE status = 'COMPLETED'`,
      ),
    },
    orphans: {
      PaymentCheck: await c(
        `SELECT COUNT(*)::bigint AS c FROM "PaymentCheck" pc LEFT JOIN "Payment" p ON p.id = pc."paymentId" WHERE p.id IS NULL`,
      ),
      ApprovalRequest: await c(
        `SELECT COUNT(*)::bigint AS c FROM "ApprovalRequest" a LEFT JOIN "Payment" p ON p.id = a."paymentId" WHERE p.id IS NULL`,
      ),
      PaymentCashAuditReview: await c(
        `SELECT COUNT(*)::bigint AS c FROM "PaymentCashAuditReview" r LEFT JOIN "Payment" p ON p.id = r."paymentId" WHERE p.id IS NULL`,
      ),
    },
    preserved: {
      customers: await c(`SELECT COUNT(*)::bigint AS c FROM "Customer" WHERE "deletedAt" IS NULL`),
      orders: await c(`SELECT COUNT(*)::bigint AS c FROM "Order" WHERE "deletedAt" IS NULL`),
      OrderPaymentBreakdown: await c(`SELECT COUNT(*)::bigint AS c FROM "OrderPaymentBreakdown"`),
      payment_plan: await c(`SELECT COUNT(*)::bigint AS c FROM payment_plan`),
      Document: await c(`SELECT COUNT(*)::bigint AS c FROM "Document"`),
      User: await c(`SELECT COUNT(*)::bigint AS c FROM "User"`),
      payment_methods: await c(`SELECT COUNT(*)::bigint AS c FROM payment_methods`),
      SourcePaymentMethod: await c(`SELECT COUNT(*)::bigint AS c FROM "SourcePaymentMethod"`),
    },
    sample_TR_131_0001: await prisma.$queryRaw<
      { orderNumber: string | null; total: string; paid: string }[]
    >`
      SELECT o."orderNumber",
             o."totalUsd"::text AS total,
             COALESCE((SELECT SUM(p."amountUsd") FROM "Payment" p WHERE p."orderId" = o.id), 0)::text AS paid
      FROM "Order" o
      WHERE o."orderNumber" = 'TR-131-0001'
      LIMIT 1
    `,
    customer_105: await prisma.$queryRaw<{ customerCode: string; balanceUsd: string }[]>`
      SELECT "customerCode", "balanceUsd"::text AS "balanceUsd"
      FROM "Customer"
      WHERE "customerCode" = '105'
      LIMIT 1
    `,
  };

  const rem = report.remaining;
  const orph = report.orphans;
  const ok =
    rem.Payment === 0 &&
    rem.PaymentCheck === 0 &&
    rem.PaymentAdjustmentFee === 0 &&
    rem.ApprovalRequest === 0 &&
    rem.PaymentCashAuditReview === 0 &&
    rem.ReceiptControl === 0 &&
    orph.PaymentCheck === 0 &&
    orph.ApprovalRequest === 0 &&
    orph.PaymentCashAuditReview === 0;

  const finalReport = { ...report, ok };
  console.log(JSON.stringify(finalReport, null, 2));

  const backupsDir = path.join(process.cwd(), "backups");
  const backups = fs
    .readdirSync(backupsDir)
    .filter((x) => x.startsWith("full-db-"))
    .sort()
    .reverse();
  if (backups[0]) {
    const dir = path.join(backupsDir, backups[0]);
    fs.writeFileSync(path.join(dir, "wipe-report-final.json"), JSON.stringify(finalReport, null, 2));
    console.log("backupDir:", dir);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
