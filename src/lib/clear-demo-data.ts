import type { PrismaClient } from "@prisma/client";

export const CLEAR_DEMO_DATA_CONFIRMATION = "DELETE DEMO DATA";

export type ClearDemoDataCounts = {
  paymentChecks: number;
  payments: number;
  orderEditRequests: number;
  orders: number;
  receiptControls: number;
  customerBalanceOverrides: number;
  customers: number;
  excelImportRows: number;
  excelImportFiles: number;
  manualImportRows: number;
  manualImports: number;
  userNotifications: number;
  auditLogs: number;
  legacyRawRows: number;
  employeeUsers: number;
};

export type ClearDemoDataPlan = {
  counts: ClearDemoDataCounts;
  preserved: string[];
  resetNotes: string[];
};

export type ClearDemoDataResult = {
  deletedAt: string;
  deleted: ClearDemoDataCounts;
  remaining: ClearDemoDataCounts;
};

export function normalizeClearDemoConfirmation(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function isClearDemoConfirmationValid(input: string): boolean {
  return normalizeClearDemoConfirmation(input) === CLEAR_DEMO_DATA_CONFIRMATION;
}

type Db = PrismaClient;

const PRESERVED_TABLES = [
  "User: ADMIN users and SUPER_ADMIN_EMAIL account",
  "Permission / UserPermission for preserved users",
  "FinancialSettings",
  "AdminSystemSettings",
  "SourcePaymentMethod",
  "SourceStatus",
  "PaymentPoint",
  "PaymentLocation",
  "IntakeLocation",
  "OrderLocation",
  "Prisma migrations and schema",
];

function superAdminEmail(): string | null {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

export function canClearDemoData(user: { role: string; email?: string | null }): boolean {
  if (user.role !== "ADMIN") return false;
  const email = superAdminEmail();
  if (!email) return true;
  return (user.email ?? "").trim().toLowerCase() === email;
}

export async function getClearDemoDataPlan(prisma: Db): Promise<ClearDemoDataPlan> {
  const employeeDeleteWhere = { role: "EMPLOYEE" as const };
  const [
    paymentChecks,
    payments,
    orderEditRequests,
    orders,
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
    employeeUsers,
  ] = await Promise.all([
    prisma.paymentCheck.count(),
    prisma.payment.count(),
    prisma.orderEditRequest.count(),
    prisma.order.count(),
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
    prisma.user.count({ where: employeeDeleteWhere }),
  ]);

  return {
    counts: {
      paymentChecks,
      payments,
      orderEditRequests,
      orders,
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
      employeeUsers,
    },
    preserved: PRESERVED_TABLES,
    resetNotes: resetNumberCounters(),
  };
}

export function resetNumberCounters(): string[] {
  return [
    "Payment capture codes reset implicitly: after deleting payments, allocateNextPaymentCapture starts again at WGP-P-000001.",
    "Order numbers reset implicitly per AH week: after deleting orders, generateNextOrderNumber starts again at {week}-0001.",
    "No database sequences are reset because business numbers are derived from existing rows, not SQL sequences.",
  ];
}

export async function clearDemoData(prisma: Db): Promise<ClearDemoDataResult> {
  const before = await getClearDemoDataPlan(prisma);
  const employeeUsers = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: { id: true },
  });
  const employeeUserIds = employeeUsers.map((u) => u.id);

  const deleted = await prisma.$transaction(
    async (tx) => {
      const paymentChecks = (await tx.paymentCheck.deleteMany()).count;
      const payments = (await tx.payment.deleteMany()).count;

      const orderEditRequests = (await tx.orderEditRequest.deleteMany()).count;
      const orders = (await tx.order.deleteMany()).count;

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

      let employeeUsersDeleted = 0;
      if (employeeUserIds.length > 0) {
        await tx.financialSettings.updateMany({
          where: { updatedById: { in: employeeUserIds } },
          data: { updatedById: null },
        });
        employeeUsersDeleted = (
          await tx.user.deleteMany({
            where: { id: { in: employeeUserIds } },
          })
        ).count;
      }

      return {
        paymentChecks,
        payments,
        orderEditRequests,
        orders,
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
        employeeUsers: employeeUsersDeleted,
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

  return {
    deletedAt: new Date().toISOString(),
    deleted,
    remaining: afterPlan.counts,
  };
}
