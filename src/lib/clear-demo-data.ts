import type { PrismaClient } from "@prisma/client";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { formatNewCustomerCode, getFirstCustomerNumber } from "@/lib/customer-code";
import { weekNumericPart } from "@/lib/work-country";

export const CLEAR_DEMO_DATA_CONFIRMATION = "DELETE DEMO DATA";

/** הפעלה מפורשת בפרודקשן / מסד עם נתונים רבים */
export const CLEAR_DEMO_DATA_ENV_FLAG = "ALLOW_CLEAR_DEMO_DATA";

export type ClearDemoDataCounts = {
  paymentChecks: number;
  payments: number;
  orderEditRequests: number;
  orders: number;
  orderWeekCounters: number;
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
  "משתמשים (ADMIN + EMPLOYEE) והרשאות (Permission / UserPermission)",
  "הגדרות: FinancialSettings, AdminSystemSettings",
  "טבלאות מקור: SourceStatus, SourcePaymentMethod, PaymentPoint, PaymentLocation, IntakeLocation, OrderLocation",
  "מדינות / שבועות עבודה (לוגיקה AH — לא נמחקים מ-DB)",
  "סכימה ומיגרציות Prisma",
];

export type ClearDemoDataEnvironmentCheck = {
  allowed: boolean;
  reason?: string;
};

export function isClearDemoDataEnvironmentAllowed(): ClearDemoDataEnvironmentCheck {
  const explicit = process.env[CLEAR_DEMO_DATA_ENV_FLAG] === "1";
  const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
  const vercelEnv = (process.env.VERCEL_ENV ?? "").toLowerCase();
  const isProd = nodeEnv === "production" || vercelEnv === "production";
  if (isProd && !explicit) {
    return {
      allowed: false,
      reason:
        `איפוס DEMO חסום בסביבת production. אם זה מסד DEMO בכוונה, הגדר ${CLEAR_DEMO_DATA_ENV_FLAG}=1 ב-env והרץ שוב. ` +
        "לנתוני לקוחות אמיתיים — צור מסד/סביבה נפרדת, אל תאפס את הקיים.",
    };
  }
  return { allowed: true };
}

export function assertClearDemoDataEnvironment(): void {
  const check = isClearDemoDataEnvironmentAllowed();
  if (!check.allowed) {
    throw new Error(check.reason ?? "איפוס DEMO אינו מותר בסביבה זו");
  }
}

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

  return {
    counts: {
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
    },
    preserved: PRESERVED_TABLES,
    resetNotes: resetNumberCounters(),
  };
}

export function resetNumberCounters(): string[] {
  const week = ACTIVE_WORK_WEEK_CODE;
  const wn = weekNumericPart(week);
  const firstN = getFirstCustomerNumber();
  const firstCode = formatNewCustomerCode(firstN);
  const customerEnvHint =
    firstN === 24001
      ? `ל-DEMO עם לקוח 100: הגדר CUSTOMER_CODE_FIRST_NUMBER=100 (הקוד המוצע: ${formatNewCustomerCode(100)}).`
      : `CUSTOMER_CODE_FIRST_NUMBER=${firstN} — לקוח ראשון מוצע: ${firstCode}.`;

  return [
    `הזמנות — רצף נפרד לכל מדינה: TR-${wn}-0001, CH-${wn}-0001, AE-${wn}-0001 (גם AH-${wn}- לטורקיה ישן).`,
    "תשלומים — TR-P-000001, CH-P-000001, AE-P-000001 (רצף נפרד לכל מדינה).",
    `לקוחות — מספור אוטומטי מהמקסימום במסד; אחרי מחיקה: ${customerEnvHint}`,
    "מונה order_week_counter נמחק — אין צורך ב-TRUNCATE; המספור נגזר מהרשומות והמונה.",
  ];
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
