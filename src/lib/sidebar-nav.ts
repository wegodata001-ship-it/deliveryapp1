export type NavIconId =
  | "home"
  | "users"
  | "orderIn"
  | "orderList"
  | "import"
  | "payIn"
  | "receipt"
  | "ledger"
  | "balances"
  | "sourceTables"
  | "reports"
  | "activity"
  | "settings"
  | "finance";

export type NavItemDef = {
  href: string;
  label: string;
  icon: NavIconId;
  /** נדרשת לפחות הרשאה אחת מהרשימה. חסר = כל משתמש מחובר */
  anyOf?: string[];
};

export type NavSectionDef = { title: string; items: NavItemDef[] };

export const SIDEBAR_SECTIONS: NavSectionDef[] = [
  {
    title: "ראשי",
    items: [{ href: "/admin", label: "מסך הבית", icon: "home" }],
  },
  {
    title: "עובדים",
    items: [{ href: "/admin/users", label: "ניהול עובדים", icon: "users", anyOf: ["manage_users"] }],
  },
  {
    title: "הזמנות",
    items: [
      { href: "/admin/orders?orderWork=new", label: "קליטת הזמנה", icon: "orderIn", anyOf: ["create_orders"] },
      { href: "/admin/orders", label: "רשימת הזמנות", icon: "orderList", anyOf: ["view_orders"] },
      { href: "/admin/import", label: "ייבוא Excel", icon: "import", anyOf: ["import_excel"] },
    ],
  },
  {
    title: "כספים ותשלומים",
    items: [
      { href: "/admin?modal=capture-payment", label: "קליטת תשלום", icon: "payIn", anyOf: ["receive_payments"] },
      { href: "/admin/receipt-control", label: "בקרת תקבולים", icon: "receipt", anyOf: ["view_payment_control"] },
      { href: "/admin/customer-card", label: "כרטסת לקוח", icon: "ledger", anyOf: ["view_customer_card"] },
      { href: "/admin/balances", label: "יתרות", icon: "balances", anyOf: ["view_reports"] },
    ],
  },
  {
    title: "מערכת",
    items: [
      { href: "/admin?modal=financial", label: "הגדרות כספים", icon: "finance", anyOf: ["manage_settings"] },
      { href: "/admin/source-tables", label: "טבלאות מקור", icon: "sourceTables", anyOf: ["manage_settings"] },
      { href: "/admin/reports", label: "דוחות", icon: "reports", anyOf: ["view_reports"] },
      { href: "/admin/activity", label: "יומן פעילות", icon: "activity", anyOf: ["manage_users"] },
      { href: "/admin/settings", label: "הגדרות", icon: "settings", anyOf: ["manage_settings"] },
    ],
  },
];

export function navItemVisible(item: NavItemDef, isAdmin: boolean, permissionKeys: string[]): boolean {
  if (isAdmin) return true;
  if (!item.anyOf?.length) return true;
  return item.anyOf.some((k) => permissionKeys.includes(k));
}

export function filterSidebarSections(isAdmin: boolean, permissionKeys: string[]): NavSectionDef[] {
  return SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((it) => navItemVisible(it, isAdmin, permissionKeys)),
  })).filter((s) => s.items.length > 0);
}
