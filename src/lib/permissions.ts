import type { PrismaClient } from "@prisma/client";
import { ensureOnce } from "@/lib/ensure-tables-once";

/** כל מפתחות ההרשאות במערכת — מקור יחיד ל-DB, sidebar, routes וטופס עובד */
export type AppPermissionKey =
  | "manage_users"
  | "manage_permissions"
  | "view_customers"
  | "manage_customers"
  | "create_orders"
  | "view_orders"
  | "edit_orders"
  | "receive_payments"
  | "view_payment_control"
  | "view_customer_card"
  | "view_reports"
  | "import_excel"
  | "manage_settings";

export type AppPermissionDef = {
  key: AppPermissionKey;
  name: string;
  description?: string;
};

export const APP_PERMISSION_DEFINITIONS: AppPermissionDef[] = [
  { key: "manage_users", name: "ניהול עובדים", description: "יצירה, עריכה והשבתת משתמשים" },
  { key: "manage_permissions", name: "ניהול הרשאות", description: "שיוך והסרת הרשאות" },
  { key: "view_customers", name: "צפייה בלקוחות", description: "קריאת רשומות לקוח" },
  { key: "manage_customers", name: "ניהול לקוחות", description: "יצירה ועדכון לקוחות" },
  { key: "create_orders", name: "קליטת הזמנה", description: "יצירת הזמנות ולקוח חדש" },
  { key: "view_orders", name: "צפייה בהזמנות", description: "רשימת הזמנות וייצוא PDF/Excel" },
  { key: "edit_orders", name: "עריכת הזמנה", description: "עדכון פרטי הזמנה וסטטוס" },
  { key: "receive_payments", name: "קליטת תשלום", description: "רישום ואישור תשלומים" },
  { key: "view_payment_control", name: "בקרת תקבולים", description: "מסך בקרת תקבולים" },
  { key: "view_customer_card", name: "כרטסת לקוח", description: "צפייה בכרטסת לקוח" },
  { key: "view_reports", name: "דוחות ויתרות", description: "דוחות, יתרות וייצוא" },
  { key: "import_excel", name: "ייבוא Excel", description: "ייבוא נתונים מקובץ" },
  { key: "manage_settings", name: "הגדרות מערכת", description: "טבלאות מקור והגדרות" },
];

/** הרשאות שניתן לשייך לעובד דרך טופס ניהול משתמשים */
export const MANAGED_EMPLOYEE_PERMISSION_KEYS = [
  "manage_users",
  "create_orders",
  "view_orders",
  "edit_orders",
  "receive_payments",
  "view_payment_control",
  "view_customer_card",
  "view_reports",
  "import_excel",
  "manage_settings",
] as const satisfies readonly AppPermissionKey[];

export type ManagedEmployeePermissionKey = (typeof MANAGED_EMPLOYEE_PERMISSION_KEYS)[number];

export const EMPLOYEE_PERMISSION_GROUPS: {
  title: string;
  entries: { key: ManagedEmployeePermissionKey; label: string }[];
}[] = [
  {
    title: "ניהול",
    entries: [{ key: "manage_users", label: "ניהול עובדים ויומן פעילות" }],
  },
  {
    title: "הזמנות",
    entries: [
      { key: "create_orders", label: "קליטת הזמנה" },
      { key: "view_orders", label: "צפייה ברשימת הזמנות (כולל ייצוא PDF/Excel)" },
      { key: "edit_orders", label: "עריכת הזמנה" },
    ],
  },
  {
    title: "תשלומים",
    entries: [
      { key: "receive_payments", label: "קליטת תשלום" },
      { key: "view_payment_control", label: "בקרת תקבולים" },
    ],
  },
  {
    title: "לקוחות",
    entries: [{ key: "view_customer_card", label: "צפייה בכרטסת לקוח" }],
  },
  {
    title: "דוחות",
    entries: [{ key: "view_reports", label: "צפייה ביתרות ודוחות" }],
  },
  {
    title: "מערכת",
    entries: [
      { key: "import_excel", label: "ייבוא Excel" },
      { key: "manage_settings", label: "הגדרות וטבלאות מקור" },
    ],
  },
];

export function uniqueManagedKeys(): ManagedEmployeePermissionKey[] {
  const seen = new Set<string>();
  const out: ManagedEmployeePermissionKey[] = [];
  for (const g of EMPLOYEE_PERMISSION_GROUPS) {
    for (const e of g.entries) {
      if (!seen.has(e.key)) {
        seen.add(e.key);
        out.push(e.key);
      }
    }
  }
  return out;
}

type Db = Pick<PrismaClient, "permission">;

/** מוודא שכל מפתחות ההרשאות קיימים ב-DB — להרצה ב-seed/deploy בלבד (ראה scripts/ensure-permissions.ts), לא ב-hot path */
export async function ensureAppPermissions(prisma: Db): Promise<void> {
  await ensureOnce("app-permissions-seed", async () => {
    await Promise.all(
      APP_PERMISSION_DEFINITIONS.map((p) =>
        prisma.permission.upsert({
          where: { key: p.key },
          create: {
            key: p.key,
            name: p.name,
            description: p.description ?? null,
            isActive: true,
          },
          update: {
            name: p.name,
            description: p.description ?? null,
            isActive: true,
          },
        }),
      ),
    );
  });
}

export async function managedPermissionIdMap(prisma: Db): Promise<Record<string, string>> {
  await ensureAppPermissions(prisma);
  const keys = uniqueManagedKeys();
  const rows = await prisma.permission.findMany({
    where: { key: { in: [...keys] }, isActive: true },
    select: { id: true, key: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}
