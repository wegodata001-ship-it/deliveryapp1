import type { PrismaClient } from "@prisma/client";

/** הקלדה מדויקת לאישור איפוס נתוני עסק (ללא מחיקת לקוחות/משתמשים). */
export const RESET_BUSINESS_DATA_CONFIRMATION = "RESET BUSINESS DATA";

export type ResetBusinessDataCounts = {
  paymentChecks: number;
  payments: number;
  orderEditRequests: number;
  orders: number;
  receiptControls: number;
  customerBalanceOverrides: number;
  excelImportRows: number;
  excelImportFiles: number;
  manualImportRows: number;
  manualImports: number;
  userNotifications: number;
  auditLogs: number;
  legacyRawRows: number;
  orderWeekCounters: number;
};

export type ResetBusinessDataPlan = {
  counts: ResetBusinessDataCounts;
  preserved: string[];
  notes: string[];
};

export type ResetBusinessDataResult = {
  resetAt: string;
  deleted: ResetBusinessDataCounts;
  remaining: ResetBusinessDataCounts;
};

export function normalizeResetBusinessConfirmation(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function isResetBusinessConfirmationValid(input: string): boolean {
  return normalizeResetBusinessConfirmation(input) === RESET_BUSINESS_DATA_CONFIRMATION;
}

type Db = PrismaClient;

const PRESERVED = [
  "Customer — כל הלקוחות נשארים",
  "User / UserPermission / Permission",
  "FinancialSettings / AdminSystemSettings",
  "SourceStatus / SourcePaymentMethod / PaymentPoint / IntakeLocation",
  "Prisma schema ומיגרציות — ללא שינוי",
];

export async function getResetBusinessDataPlan(prisma: Db): Promise<ResetBusinessDataPlan> {
  const counts = await countBusinessRows(prisma);
  return {
    counts,
    preserved: PRESERVED,
    notes: [
      "יתרות לקוחות, כרטסת ודוחות מחושבים מהזמנות והתשלומים — אחרי מחיקה יוצג 0.",
      "אין טבלאות OrderItem / CustomerLedger / Expense / Task ב-DB — אין מה למחוק שם.",
      "מוני הזמנות (order_week_counter) מאופסים.",
    ],
  };
}

async function countBusinessRows(prisma: Db): Promise<ResetBusinessDataCounts> {
  const [
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
  ] = await Promise.all([
    prisma.paymentCheck.count(),
    prisma.payment.count(),
    prisma.orderEditRequest.count(),
    prisma.order.count(),
    prisma.receiptControl.count(),
    prisma.customerBalanceStatusOverride.count(),
    prisma.excelImportRow.count(),
    prisma.excelImportFile.count(),
    prisma.manualImportRow.count(),
    prisma.manualImport.count(),
    prisma.userNotification.count(),
    prisma.auditLog.count(),
    prisma.legacyRawRow.count(),
    prisma.orderWeekCounter.count(),
  ]);

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
}

export type ResetBusinessDataOptions = {
  /** מחיקת AuditLog (יומן פעילות) — ברירת מחדל: כן */
  includeAuditLogs?: boolean;
  /** מחיקת LegacyRawRow — ברירת מחדל: כן */
  includeLegacyImports?: boolean;
};

/**
 * איפוס מלא של נתוני עסק — הזמנות, תשלומים, ייבוא, התראות.
 * לא נוגע בלקוחות, משתמשים, הרשאות או הגדרות מערכת.
 */
export async function resetBusinessData(
  prisma: Db,
  options: ResetBusinessDataOptions = {},
): Promise<ResetBusinessDataResult> {
  const includeAuditLogs = options.includeAuditLogs !== false;
  const includeLegacyImports = options.includeLegacyImports !== false;

  const before = await countBusinessRows(prisma);

  const deleted = await prisma.$transaction(
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
      const auditLogs = includeAuditLogs ? (await tx.auditLog.deleteMany()).count : 0;
      const legacyRawRows = includeLegacyImports ? (await tx.legacyRawRow.deleteMany()).count : 0;
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
      } satisfies ResetBusinessDataCounts;
    },
    { maxWait: 15_000, timeout: 180_000 },
  );

  const remaining = await countBusinessRows(prisma);
  const plannedDeletes =
    before.paymentChecks +
    before.payments +
    before.orderEditRequests +
    before.orders +
    before.receiptControls +
    before.customerBalanceOverrides +
    before.excelImportRows +
    before.excelImportFiles +
    before.manualImportRows +
    before.manualImports +
    before.userNotifications +
    (includeAuditLogs ? before.auditLogs : 0) +
    (includeLegacyImports ? before.legacyRawRows : 0) +
    before.orderWeekCounters;

  const actualDeletes = Object.values(deleted).reduce((s, n) => s + n, 0);
  if (plannedDeletes > 0 && actualDeletes === 0) {
    throw new Error("לא נמחקו רשומות — בדוק חיבור למסד הנתונים (DATABASE_URL)");
  }

  if (remaining.orders > 0 || remaining.payments > 0) {
    throw new Error(`נותרו רשומות אחרי האיפוס: orders=${remaining.orders}, payments=${remaining.payments}`);
  }

  return {
    resetAt: new Date().toISOString(),
    deleted,
    remaining,
  };
}
