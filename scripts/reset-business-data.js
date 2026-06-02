/**
 * איפוס מלא של נתוני עסק — שומר לקוחות, משתמשים והגדרות.
 *
 * שימוש:
 *   node scripts/reset-business-data.js --confirm
 *
 * דורש DATABASE_URL ב-.env
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const CONFIRMATION = "RESET BUSINESS DATA";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--confirm")) {
    console.error("⚠️  פעולה הרסנית. הרץ עם: node scripts/reset-business-data.js --confirm");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const before = await Promise.all([
      prisma.customer.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count(),
      prisma.paymentCheck.count(),
    ]);

    console.log("לפני איפוס:");
    console.table({
      customers: before[0],
      users: before[1],
      orders: before[2],
      payments: before[3],
      paymentChecks: before[4],
    });

    if (before[2] === 0 && before[3] === 0) {
      console.log("אין הזמנות/תשלומים למחיקה — המערכת כבר ריקה.");
      return;
    }

    console.log(`\nמבצע איפוס (${CONFIRMATION})...\n`);

    const result = await prisma.$transaction(
      async (tx) => {
        const paymentChecks = (await tx.paymentCheck.deleteMany()).count;
        const payments = (await tx.payment.deleteMany()).count;
        const orderEditRequests = (await tx.orderEditRequest.deleteMany()).count;
        const orders = (await tx.order.deleteMany()).count;
        const receiptControls = (await tx.receiptControl.deleteMany()).count;
        const customerBalanceOverrides = (await tx.customerBalanceStatusOverride.deleteMany()).count;
        const excelImportRows = (await tx.excelImportRow.deleteMany()).count;
        const excelImportFiles = (await tx.excelImportFile.deleteMany()).count;
        const manualImportRows = (await tx.manualImportRow.deleteMany()).count;
        const manualImports = (await tx.manualImport.deleteMany()).count;
        const userNotifications = (await tx.userNotification.deleteMany()).count;
        const auditLogs = (await tx.auditLog.deleteMany()).count;
        const legacyRawRows = (await tx.legacyRawRow.deleteMany()).count;
        const orderWeekCounters = (await tx.orderWeekCounter.deleteMany()).count;

        return {
          paymentChecks,
          payments,
          orderEditRequests,
          orders,
          receiptControls,
          customerBalanceOverrides,
          excelImportRows,
          excelImportFiles,
          manualImportRows,
          manualImports,
          userNotifications,
          auditLogs,
          legacyRawRows,
          orderWeekCounters,
        };
      },
      { maxWait: 15000, timeout: 180000 },
    );

    console.log("נמחק:");
    console.table(result);

    const after = await Promise.all([
      prisma.customer.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.payment.count(),
    ]);

    console.log("\nאחרי איפוס:");
    console.table({
      customers_kept: after[0],
      users_kept: after[1],
      orders: after[2],
      payments: after[3],
    });

    if (after[2] !== 0 || after[3] !== 0) {
      console.error("❌ עדיין יש הזמנות/תשלומים!");
      process.exit(1);
    }

    console.log("\n✅ איפוס הושלם. לקוחות ומשתמשים נשמרו.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
