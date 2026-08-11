import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { formatNewCustomerCode, getFirstCustomerNumber } from "@/lib/customer-code.shared";
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

const PRESERVED_TABLES = [
  "משתמשים (ADMIN + EMPLOYEE) והרשאות (Permission / UserPermission)",
  "הגדרות: FinancialSettings, AdminSystemSettings",
  "טבלאות מקור: SourceStatus, SourcePaymentMethod, PaymentPoint, PaymentLocation, IntakeLocation, OrderLocation",
  "מדינות / שבועות עבודה (לוגיקה AH — לא נמחקים מ-DB)",
  "סכימה ומיגרציות Prisma",
];

export function buildClearDemoDataPlan(counts: ClearDemoDataCounts): ClearDemoDataPlan {
  return {
    counts,
    preserved: PRESERVED_TABLES,
    resetNotes: resetNumberCounters(),
  };
}
