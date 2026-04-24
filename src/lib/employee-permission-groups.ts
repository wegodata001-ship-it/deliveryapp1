/**
 * הרשאות שמוצגות בטופס עובד בלבד (מפתחות קיימים ב-Prisma).
 * מנהל מערכת (ADMIN) נכנס להכל — לא נשמרות לו שורות UserPermission מהטופס.
 */
export const MANAGED_EMPLOYEE_PERMISSION_KEYS = [
  "create_orders",
  "view_orders",
  "edit_orders",
  "receive_payments",
  "view_payment_control",
  "view_customer_card",
  "view_reports",
  "import_excel",
  "manage_settings",
] as const;

export type ManagedEmployeePermissionKey = (typeof MANAGED_EMPLOYEE_PERMISSION_KEYS)[number];

export const EMPLOYEE_PERMISSION_GROUPS: {
  title: string;
  entries: { key: ManagedEmployeePermissionKey; label: string }[];
}[] = [
  {
    title: "הזמנות",
    entries: [
      { key: "create_orders", label: "קליטת הזמנה" },
      { key: "view_orders", label: "צפייה ברשימת הזמנות" },
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
    entries: [
      { key: "view_customer_card", label: "צפייה בכרטסת לקוח" },
      /** מפתח יחיד במסד — כולל דוחות ויתרות */
      { key: "view_reports", label: "צפייה ביתרות ודוחות" },
    ],
  },
  {
    title: "מערכת",
    entries: [
      { key: "import_excel", label: "ייבוא Excel" },
      { key: "manage_settings", label: "ניהול טבלאות מקור" },
    ],
  },
];

/** מפתחות ייחודיים לטופס (view_reports מופיע פעמיים בממשק — שיוך אחד לשורה) */
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
