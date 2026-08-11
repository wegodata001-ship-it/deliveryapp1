import "server-only";

import type { PrismaClient } from "@prisma/client";
import {
  buildClearDemoDataPlan,
  isClearDemoDataEnvironmentAllowed,
  type ClearDemoDataCounts,
  type ClearDemoDataPlan,
  type ClearDemoDataResult,
} from "@/lib/clear-demo-data.shared";

export {
  CLEAR_DEMO_DATA_CONFIRMATION,
  CLEAR_DEMO_DATA_ENV_FLAG,
  canClearDemoData,
  isClearDemoConfirmationValid,
  isClearDemoDataEnvironmentAllowed,
  normalizeClearDemoConfirmation,
  resetNumberCounters,
  type ClearDemoDataCounts,
  type ClearDemoDataEnvironmentCheck,
  type ClearDemoDataPlan,
  type ClearDemoDataResult,
} from "@/lib/clear-demo-data.shared";

type Db = PrismaClient;

export function assertClearDemoDataEnvironment(): void {
  const check = isClearDemoDataEnvironmentAllowed();
  if (!check.allowed) {
    throw new Error(check.reason ?? "איפוס DEMO אינו מותר בסביבה זו");
  }
}

export async function getClearDemoDataPlan(prisma: Db): Promise<ClearDemoDataPlan> {
  const [
    paymentChecks,
    payments,
    orderEditRequests,
    orders,
    orderWeekCounters,
    receiptControls,
    customerBalanceOverrides,
    customers,
    excelImportRows,
    excelImportFiles,
    manualImportRows,
    manualImports,
    userNotifications,
    auditLogs,
    legacyRawRows,
  ] = await Promise.all([
    prisma.paymentCheck.count(),
    prisma.payment.count(),
    prisma.orderEditRequest.count(),
    prisma.order.count(),
    prisma.orderWeekCounter.count(),
    prisma.receiptControl.count(),
    prisma.customerBalanceStatusOverride.count(),
    prisma.customer.count(),
    prisma.excelImportRow.count(),
    prisma.excelImportFile.count(),
    prisma.manualImportRow.count(),
    prisma.manualImport.count(),
    prisma.userNotification.count(),
    prisma.auditLog.count(),
    prisma.legacyRawRow.count(),
  ]);

  return buildClearDemoDataPlan({
    paymentChecks,
    payments,
    orderEditRequests,
    orders,
    orderWeekCounters,
    receiptControls,
    customerBalanceOverrides,
    customers,
    excelImportRows,
    excelImportFiles,
    manualImportRows,
    manualImports,
    userNotifications,
    auditLogs,
    legacyRawRows,
    employeeUsers: 0,
  });
}

export async function clearDemoData(prisma: Db): Promise<ClearDemoDataResult> {
  assertClearDemoDataEnvironment();
  const before = await getClearDemoDataPlan(prisma);

  const deleted = await prisma.$transaction(
    async (tx) => {
      const paymentChecks = (await tx.paymentCheck.deleteMany()).count;
      const payments = (await tx.payment.deleteMany()).count;

      const orderEditRequests = (await tx.orderEditRequest.deleteMany()).count;
      const orders = (await tx.order.deleteMany()).count;
      const orderWeekCounters = (await tx.orderWeekCounter.deleteMany()).count;

      const receiptControls = (await tx.receiptControl.deleteMany()).count;
      const customerBalanceOverrides = (await tx.customerBalanceStatusOverride.deleteMany()).count;
      const customers = (await tx.customer.deleteMany()).count;

      const excelImportRows = (await tx.excelImportRow.deleteMany()).count;
      const excelImportFiles = (await tx.excelImportFile.deleteMany()).count;
      const manualImportRows = (await tx.manualImportRow.deleteMany()).count;
      const manualImports = (await tx.manualImport.deleteMany()).count;

      const userNotifications = (await tx.userNotification.deleteMany()).count;
      const auditLogs = (await tx.auditLog.deleteMany()).count;
      const legacyRawRows = (await tx.legacyRawRow.deleteMany()).count;

      return {
        paymentChecks,
        payments,
        orderEditRequests,
        orders,
        orderWeekCounters,
        receiptControls,
        customerBalanceOverrides,
        customers,
        excelImportRows,
        excelImportFiles,
        manualImportRows,
        manualImports,
        userNotifications,
        auditLogs,
        legacyRawRows,
        employeeUsers: 0,
      } satisfies ClearDemoDataCounts;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  const afterPlan = await getClearDemoDataPlan(prisma);
  const plannedTotal = Object.values(before.counts).reduce((sum, n) => sum + n, 0);
  const deletedTotal = Object.values(deleted).reduce((sum, n) => sum + n, 0);
  if (plannedTotal > 0 && deletedTotal === 0) {
    throw new Error("לא נמחקו רשומות — בדוק חיבור למסד הנתונים (DATABASE_URL)");
  }

  const after = afterPlan.counts;
  if (after.orders > 0 || after.payments > 0 || after.customers > 0) {
    throw new Error(
      `נותרו נתוני עסק אחרי האיפוס: orders=${after.orders}, payments=${after.payments}, customers=${after.customers}`,
    );
  }

  return {
    deletedAt: new Date().toISOString(),
    deleted,
    remaining: afterPlan.counts,
  };
}
