/**
 * Wipe ALL business data for week AH-125 only (demo cleanup).
 * Preserves customers, users, settings, products/suppliers, and all other weeks.
 *
 * Dry-run:  npx tsx scripts/wipe-week-ah125.ts
 * Execute:  npx tsx scripts/wipe-week-ah125.ts --confirm "DELETE AH-125"
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const TARGET_WEEK = "AH-125";
const CONFIRMATION = "DELETE AH-125";
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

function readConfirmArg(): string {
  const idx = process.argv.indexOf("--confirm");
  if (idx === -1) return "";
  return (process.argv[idx + 1] ?? "").trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  loadEnvLocal();

  const orders = await prisma.order.findMany({
    where: { weekCode: TARGET_WEEK },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  const paymentsByWeek = await prisma.payment.findMany({
    where: { weekCode: TARGET_WEEK },
    select: { id: true },
  });
  const paymentsByOrder =
    orderIds.length === 0
      ? []
      : await prisma.payment.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        });

  const paymentIdSet = new Set<string>();
  for (const p of paymentsByWeek) paymentIdSet.add(p.id);
  for (const p of paymentsByOrder) paymentIdSet.add(p.id);
  const paymentIds = [...paymentIdSet];

  const breakdownCount =
    orderIds.length === 0
      ? 0
      : await prisma.orderPaymentBreakdown.count({ where: { orderId: { in: orderIds } } });
  const allocationCount =
    paymentIds.length === 0
      ? 0
      : await prisma.paymentMethodAllocation.count({ where: { paymentId: { in: paymentIds } } });

  const cashExpenseCount = await prisma.cashExpense.count({ where: { weekCode: TARGET_WEEK } });
  const cashCountCount = await prisma.cashCount.count({ where: { weekCode: TARGET_WEEK } });
  const drawerCount = await prisma.cashDailyDrawerCount.count({ where: { weekCode: TARGET_WEEK } });
  const cashWeekFlowCount = await prisma.cashWeekFlow.count({ where: { weekCode: TARGET_WEEK } });
  const turkeyMoveCount = await prisma.turkeyTransferMovement.count({
    where: { weekCode: TARGET_WEEK },
  });
  const auditReviewCount = await prisma.paymentCashAuditReview.count({
    where: { weekCode: TARGET_WEEK },
  });
  const orderWeekCounter = await prisma.orderWeekCounter.count({
    where: { weekCode: TARGET_WEEK },
  });

  const otherWeeksBefore = await prisma.$queryRaw<{ week: string; c: number }[]>`
    SELECT COALESCE("weekCode", '(null)') AS week, COUNT(*)::int AS c
    FROM "Order"
    WHERE COALESCE("weekCode", '') <> ${TARGET_WEEK}
    GROUP BY 1
    ORDER BY 1
  `;
  const customersBefore = await prisma.customer.count({ where: { deletedAt: null } });
  const usersBefore = await prisma.user.count();

  console.log("\n=== PLAN — wipe week", TARGET_WEEK, "===\n");
  console.table({
    orders: orderIds.length,
    payments: paymentIds.length,
    orderPaymentBreakdown: breakdownCount,
    paymentMethodAllocation: allocationCount,
    cashExpense: cashExpenseCount,
    cashCount: cashCountCount,
    cashDailyDrawerCount: drawerCount,
    cashWeekFlow: cashWeekFlowCount,
    turkeyTransferMovement: turkeyMoveCount,
    paymentCashAuditReview: auditReviewCount,
    orderWeekCounter,
  });
  console.log("Preserved (will not delete): Customers, Users, Settings, other weeks");
  console.log("Other-week order counts before:", otherWeeksBefore);
  console.log({ customersBefore, usersBefore });

  if (readConfirmArg() !== CONFIRMATION) {
    console.log("\nDry run only. To delete, run:");
    console.log(`npx tsx scripts/wipe-week-ah125.ts --confirm "${CONFIRMATION}"`);
    process.exitCode = 1;
    return;
  }

  const deleted: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      // 1) Payment children / dependents (by payment id)
      for (const ids of chunk(paymentIds, 500)) {
        if (ids.length === 0) break;
        deleted.PaymentCheck =
          (deleted.PaymentCheck ?? 0) +
          (await tx.paymentCheck.deleteMany({ where: { paymentId: { in: ids } } })).count;
        deleted.ApprovalRequest =
          (deleted.ApprovalRequest ?? 0) +
          (await tx.approvalRequest.deleteMany({ where: { paymentId: { in: ids } } })).count;
        deleted.PaymentCashAuditReview =
          (deleted.PaymentCashAuditReview ?? 0) +
          (await tx.paymentCashAuditReview.deleteMany({ where: { paymentId: { in: ids } } })).count;
        deleted.PaymentMethodAllocation =
          (deleted.PaymentMethodAllocation ?? 0) +
          (await tx.paymentMethodAllocation.deleteMany({ where: { paymentId: { in: ids } } })).count;
        deleted.PaymentAdjustmentFee_byPayment =
          (deleted.PaymentAdjustmentFee_byPayment ?? 0) +
          (await tx.paymentAdjustmentFee.deleteMany({ where: { paymentId: { in: ids } } })).count;
      }

      // Also week-scoped audit reviews (in case payment already gone)
      deleted.PaymentCashAuditReview_week =
        (
          await tx.paymentCashAuditReview.deleteMany({ where: { weekCode: TARGET_WEEK } })
        ).count;

      // 2) Order dependents
      for (const ids of chunk(orderIds, 500)) {
        if (ids.length === 0) break;
        deleted.PaymentAdjustmentFee_byOrder =
          (deleted.PaymentAdjustmentFee_byOrder ?? 0) +
          (await tx.paymentAdjustmentFee.deleteMany({ where: { orderId: { in: ids } } })).count;
        deleted.OrderEditRequest =
          (deleted.OrderEditRequest ?? 0) +
          (await tx.orderEditRequest.deleteMany({ where: { orderId: { in: ids } } })).count;
        deleted.PaymentPlan =
          (deleted.PaymentPlan ?? 0) +
          (await tx.paymentPlan.deleteMany({ where: { orderId: { in: ids } } })).count;
        deleted.OrderPaymentBreakdown =
          (deleted.OrderPaymentBreakdown ?? 0) +
          (await tx.orderPaymentBreakdown.deleteMany({ where: { orderId: { in: ids } } })).count;
      }

      // Payment plans created in this week for other orders (edge)
      deleted.PaymentPlan_createdInWeek =
        (
          await tx.paymentPlan.deleteMany({
            where: {
              OR: [
                { createdInWeekCode: TARGET_WEEK },
                { sourceWeekCode: TARGET_WEEK },
              ],
            },
          })
        ).count;

      // 3) Payments (week + linked to week orders)
      for (const ids of chunk(paymentIds, 500)) {
        if (ids.length === 0) break;
        deleted.Payment =
          (deleted.Payment ?? 0) +
          (await tx.payment.deleteMany({ where: { id: { in: ids } } })).count;
      }
      // Safety: any leftover with weekCode
      deleted.Payment_leftoverWeek =
        (await tx.payment.deleteMany({ where: { weekCode: TARGET_WEEK } })).count;

      // 4) Soft-delete documents for removed orders/payments
      if (orderIds.length > 0) {
        for (const ids of chunk(orderIds, 400)) {
          const n = await tx.$executeRaw`
            UPDATE "Document"
            SET "deletedAt" = NOW()
            WHERE "entityType" = 'ORDER'
              AND "deletedAt" IS NULL
              AND "entityId" IN (${Prisma.join(ids)})
          `;
          deleted.Document_orderSoftDeleted = (deleted.Document_orderSoftDeleted ?? 0) + Number(n);
        }
      }
      if (paymentIds.length > 0) {
        for (const ids of chunk(paymentIds, 400)) {
          const n = await tx.$executeRaw`
            UPDATE "Document"
            SET "deletedAt" = NOW()
            WHERE "entityType" = 'PAYMENT'
              AND "deletedAt" IS NULL
              AND "entityId" IN (${Prisma.join(ids)})
          `;
          deleted.Document_paymentSoftDeleted =
            (deleted.Document_paymentSoftDeleted ?? 0) + Number(n);
        }
      }

      // 5) Audit logs for removed entities (ledger-style activity)
      if (orderIds.length > 0) {
        for (const ids of chunk(orderIds, 400)) {
          deleted.AuditLog_order =
            (deleted.AuditLog_order ?? 0) +
            (
              await tx.auditLog.deleteMany({
                where: { entityType: "ORDER", entityId: { in: ids } },
              })
            ).count;
        }
      }
      if (paymentIds.length > 0) {
        for (const ids of chunk(paymentIds, 400)) {
          deleted.AuditLog_payment =
            (deleted.AuditLog_payment ?? 0) +
            (
              await tx.auditLog.deleteMany({
                where: { entityType: "PAYMENT", entityId: { in: ids } },
              })
            ).count;
        }
      }

      // 6) Cash control week-scoped rows
      deleted.TurkeyTransferMovement = (
        await tx.turkeyTransferMovement.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;
      deleted.CashWeekFlow = (
        await tx.cashWeekFlow.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;
      deleted.CashDailyDrawerCount = (
        await tx.cashDailyDrawerCount.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;
      deleted.CashExpense = (
        await tx.cashExpense.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;
      deleted.CashCount = (
        await tx.cashCount.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;

      // Receipt control for this week
      deleted.ReceiptControl = (
        await tx.receiptControl.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;

      // Inventory count sessions for this week (catalog items preserved)
      deleted.InventoryCount = (
        await tx.inventoryCount.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;

      // 7) Orders
      for (const ids of chunk(orderIds, 500)) {
        if (ids.length === 0) break;
        deleted.Order =
          (deleted.Order ?? 0) +
          (await tx.order.deleteMany({ where: { id: { in: ids } } })).count;
      }
      deleted.Order_leftoverWeek = (
        await tx.order.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;

      // 8) Week counter
      deleted.OrderWeekCounter = (
        await tx.orderWeekCounter.deleteMany({ where: { weekCode: TARGET_WEEK } })
      ).count;

      // 9) Recalculate Customer.balanceUsd snapshot:
      // internal = payments + debtWithdrawals − orders  (negative = open debt)
      await tx.$executeRaw`
        UPDATE "Customer" c
        SET "balanceUsd" = COALESCE((
          SELECT ROUND((
            COALESCE((
              SELECT SUM(COALESCE(p."amountUsd", 0))
              FROM "Payment" p
              WHERE p."customerId" = c.id
                AND p."status" = 'ACTIVE'
                AND p."isPaid" = true
            ), 0)
            +
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
        WHERE c."deletedAt" IS NULL
      `;
      deleted.Customer_balancesRecalculated = await tx.customer.count({
        where: { deletedAt: null },
      });
    },
    { timeout: 600_000, maxWait: 60_000 },
  );

  // Verification
  const remainingOrders = await prisma.order.count({ where: { weekCode: TARGET_WEEK } });
  const remainingPayments = await prisma.payment.count({ where: { weekCode: TARGET_WEEK } });
  const remainingBreakdown =
    remainingOrders === 0
      ? 0
      : await prisma.orderPaymentBreakdown.count({
          where: { order: { weekCode: TARGET_WEEK } },
        });
  const remainingAlloc =
    remainingPayments === 0
      ? 0
      : await prisma.paymentMethodAllocation.count({
          where: { payment: { weekCode: TARGET_WEEK } },
        });
  const remainingCashExp = await prisma.cashExpense.count({ where: { weekCode: TARGET_WEEK } });
  const remainingDrawer = await prisma.cashDailyDrawerCount.count({
    where: { weekCode: TARGET_WEEK },
  });
  const otherWeeksAfter = await prisma.$queryRaw<{ week: string; c: number }[]>`
    SELECT COALESCE("weekCode", '(null)') AS week, COUNT(*)::int AS c
    FROM "Order"
    WHERE COALESCE("weekCode", '') <> ${TARGET_WEEK}
    GROUP BY 1
    ORDER BY 1
  `;
  const customersAfter = await prisma.customer.count({ where: { deletedAt: null } });
  const usersAfter = await prisma.user.count();

  const otherWeeksUnchanged =
    JSON.stringify(otherWeeksBefore) === JSON.stringify(otherWeeksAfter) &&
    customersBefore === customersAfter &&
    usersBefore === usersAfter;

  const weekEmpty =
    remainingOrders === 0 &&
    remainingPayments === 0 &&
    remainingBreakdown === 0 &&
    remainingAlloc === 0 &&
    remainingCashExp === 0 &&
    remainingDrawer === 0;

  const report = {
    week: TARGET_WEEK,
    deleted: {
      orders: (deleted.Order ?? 0) + (deleted.Order_leftoverWeek ?? 0),
      payments: (deleted.Payment ?? 0) + (deleted.Payment_leftoverWeek ?? 0),
      orderPaymentBreakdown: deleted.OrderPaymentBreakdown ?? 0,
      paymentMethodAllocation: deleted.PaymentMethodAllocation ?? 0,
      paymentPlan: (deleted.PaymentPlan ?? 0) + (deleted.PaymentPlan_createdInWeek ?? 0),
      paymentAdjustmentFee:
        (deleted.PaymentAdjustmentFee_byPayment ?? 0) +
        (deleted.PaymentAdjustmentFee_byOrder ?? 0),
      cashExpense: deleted.CashExpense ?? 0,
      cashDailyDrawerCount: deleted.CashDailyDrawerCount ?? 0,
      cashWeekFlow: deleted.CashWeekFlow ?? 0,
      cashCount: deleted.CashCount ?? 0,
      turkeyTransferMovement: deleted.TurkeyTransferMovement ?? 0,
      auditLogs:
        (deleted.AuditLog_order ?? 0) + (deleted.AuditLog_payment ?? 0),
      orderWeekCounter: deleted.OrderWeekCounter ?? 0,
      all: deleted,
    },
    verification: {
      remainingOrdersAH125: remainingOrders,
      remainingPaymentsAH125: remainingPayments,
      remainingBreakdownAH125: remainingBreakdown,
      remainingAllocationsAH125: remainingAlloc,
      remainingCashExpenseAH125: remainingCashExp,
      remainingDrawerAH125: remainingDrawer,
      weekEmpty,
      customersPreserved: customersBefore === customersAfter,
      usersPreserved: usersBefore === usersAfter,
      otherWeeksUnchanged,
      otherWeeksBefore,
      otherWeeksAfter,
    },
  };

  console.log("\n=== REPORT ===\n");
  console.log(`Orders deleted:     ${report.deleted.orders}`);
  console.log(`Payments deleted:   ${report.deleted.payments}`);
  console.log(`Breakdown deleted:  ${report.deleted.orderPaymentBreakdown}`);
  console.log(`Allocations deleted:${report.deleted.paymentMethodAllocation}`);
  console.log("\nFull deleted map:");
  console.table(deleted);
  console.log("\nVerification:");
  console.log(JSON.stringify(report.verification, null, 2));
  console.log(
    weekEmpty && otherWeeksUnchanged
      ? "\nOK — AH-125 is empty; other weeks / customers / users unchanged."
      : "\nWARNING — verification failed; inspect report above.",
  );

  const outDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `wipe-${TARGET_WEEK}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReport saved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
