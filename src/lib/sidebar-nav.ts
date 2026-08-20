import type { AdminWindowPayload } from "@/lib/admin-windows";

export type NavIconId =
  | "home"
  | "users"
  | "orderIn"
  | "orderList"
  | "customerNew"
  | "import"
  | "payIn"
  | "receipt"
  | "ledger"
  | "balances"
  | "sourceTables"
  | "reports"
  | "activity"
  | "settings"
  | "finance"
  | "editRequests"
  | "reconcile"
  | "cashbox"
  | "documents"
  | "shipments";

export type NavItemDef = {
  href: string;
  label: string;
  icon: NavIconId;
  /** נדרשת לפחות הרשאה אחת מהרשימה. חסר = כל משתמש מחובר */
  anyOf?: string[];
  /** רק משתמש עם role ADMIN */
  adminOnly?: boolean;
  /** פותח חלון במקום ניווט (ללא שינוי route) */
  openWindow?: AdminWindowPayload;
  /** פותח מודאל הגדרות כספים (state מקומי, בלי query) */
  openFinancialModal?: boolean;
};

export type NavGroupDef = {
  id: string;
  label: string;
  groupIcon: NavIconId;
  items: NavItemDef[];
};

/** @deprecated — תאימות; השתמשו ב-SIDEBAR_GROUPS */
export type NavSectionDef = { title: string; items: NavItemDef[] };

/** פריט קבוע — מסך הבית (מחוץ ל-accordion) */
export const SIDEBAR_HOME_ITEM: NavItemDef = {
  href: "/admin",
  label: "מסך הבית",
  icon: "home",
};

export const SIDEBAR_GROUPS: NavGroupDef[] = [
  {
    id: "finance",
    label: "יתרות וכספים",
    groupIcon: "finance",
    items: [
      {
        href: "/admin/orders",
        label: "קליטת הזמנה",
        icon: "orderIn",
        anyOf: ["create_orders"],
        openWindow: { type: "orderCapture", props: { mode: "create" } },
      },
      { href: "/admin/orders", label: "רשימת הזמנות", icon: "orderList", anyOf: ["view_orders"] },
      {
        href: "/admin/orders",
        label: "לקוח חדש",
        icon: "customerNew",
        anyOf: ["create_orders"],
        openWindow: { type: "createCustomer" },
      },
      {
        href: "/admin/customers",
        label: "לקוחות",
        icon: "users",
        anyOf: ["view_customers", "view_customer_card", "view_reports"],
      },
      {
        href: "/admin/customer-card",
        label: "כרטסת לקוח",
        icon: "ledger",
        anyOf: ["view_customer_card"],
        openWindow: { type: "customerCard", props: {} },
      },
      { href: "/admin/balances", label: "יתרות", icon: "balances", anyOf: ["view_reports"] },
      {
        href: "/admin",
        label: "קליטת תשלום",
        icon: "payIn",
        anyOf: ["receive_payments"],
        openWindow: { type: "paymentsUpdated", props: {} },
      },
      {
        href: "/admin/cash-expenses",
        label: "הוצאות קופה",
        icon: "cashbox",
        anyOf: ["view_payment_control"],
      },
    ],
  },
  {
    id: "shipments",
    label: "משלוחים",
    groupIcon: "shipments",
    items: [
      {
        href: "/admin/shipments",
        label: "מערכת משלוחים",
        icon: "shipments",
        anyOf: ["manage_shipments", "view_shipments"],
      },
      {
        href: "/admin/shipments/turkey",
        label: "רשימת משלוחים",
        icon: "shipments",
        anyOf: ["manage_shipments", "view_shipments"],
      },
      {
        href: "/admin/shipments/turkey/import",
        label: "ייבוא משלוח",
        icon: "import",
        anyOf: ["manage_shipments"],
      },
      {
        href: "/admin/shipments/turkey/locations",
        label: "ניהול יישובים ואזורי חלוקה",
        icon: "receipt",
        anyOf: ["manage_shipments", "view_shipments"],
      },
      {
        href: "/admin/shipments/turkey/control",
        label: "בקרת משלוחים",
        icon: "receipt",
        anyOf: ["manage_shipments", "view_shipments"],
      },
      {
        href: "/admin/shipments/turkey/cash-control",
        label: "בקרת קופה – משלוחים",
        icon: "cashbox",
        anyOf: ["manage_shipments", "view_shipments"],
      },
      {
        href: "/admin/shipments/turkey/manual",
        label: "משלוחים – הזנה ידנית",
        icon: "orderIn",
        anyOf: ["manage_shipments", "view_shipments"],
      },
    ],
  },
  {
    id: "controls",
    label: "בקרות",
    groupIcon: "reconcile",
    items: [
      {
        href: "/admin/reconciliation",
        label: "התאמת מערכות",
        icon: "reconcile",
        anyOf: ["view_reports"],
      },
      {
        href: "/admin/cash-control",
        label: "בקרת קופה",
        icon: "cashbox",
        anyOf: ["view_payment_control"],
      },
      {
        href: "/admin/cash-flow",
        label: "בקרת תזרים",
        icon: "finance",
        anyOf: ["cashflow.view", "view_payment_control"],
      },
      {
        href: "/admin/edit-requests",
        label: "בקשות עריכה",
        icon: "editRequests",
        anyOf: ["invoice.cancel.approve"],
      },
      {
        href: "/admin/payment-method-adjustments",
        label: "התאמות אמצעי תשלום",
        icon: "editRequests",
        anyOf: ["manage_users"],
      },
      {
        href: "/admin/my-requests",
        label: "הבקשות שלי",
        icon: "editRequests",
        anyOf: ["edit_orders"],
      },
    ],
  },
  {
    id: "reports",
    label: "דוחות ומסמכים",
    groupIcon: "reports",
    items: [
      { href: "/admin/reports", label: "דוחות", icon: "reports", anyOf: ["view_reports"] },
      { href: "/admin/documents", label: "ארכיון מסמכים", icon: "documents", anyOf: ["documents.view"] },
    ],
  },
  {
    id: "system",
    label: "מערכת",
    groupIcon: "settings",
    items: [
      { href: "/admin/users", label: "ניהול עובדים", icon: "users", anyOf: ["manage_users"] },
      { href: "/admin/source-tables", label: "טבלאות מקור", icon: "sourceTables", anyOf: ["manage_settings"] },
      { href: "/admin/activity", label: "יומן פעולות", icon: "activity", anyOf: ["manage_users"] },
      {
        href: "/admin",
        label: "הגדרות כספים",
        icon: "finance",
        anyOf: ["manage_settings"],
        openFinancialModal: true,
      },
    ],
  },
];

/** @deprecated — נגזר מ-SIDEBAR_GROUPS לתאימות */
export const SIDEBAR_SECTIONS: NavSectionDef[] = [
  { title: "ראשי", items: [SIDEBAR_HOME_ITEM] },
  ...SIDEBAR_GROUPS.map((g) => ({ title: g.label, items: g.items })),
];

const FINANCE_PATH_PREFIXES = [
  "/admin/orders",
  "/admin/customers",
  "/admin/customer-card",
  "/admin/balances",
  "/admin/cash-expenses",
  "/admin/receipt-control",
];

const SHIPMENTS_PATH_PREFIXES = ["/admin/shipments"];

const CONTROLS_PATH_PREFIXES = [
  "/admin/reconciliation",
  "/admin/cash-control",
  "/admin/cash-flow",
  "/admin/edit-requests",
  "/admin/payment-method-adjustments",
  "/admin/order-edit-requests",
  "/admin/invoice-cancel-requests",
  "/admin/my-requests",
];

const REPORTS_PATH_PREFIXES = ["/admin/reports", "/admin/documents"];

const SYSTEM_PATH_PREFIXES = ["/admin/users", "/admin/source-tables", "/admin/activity"];

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function navGroupIdForPathname(pathname: string): string | null {
  if (SHIPMENTS_PATH_PREFIXES.some((p) => pathMatchesPrefix(pathname, p))) return "shipments";
  if (CONTROLS_PATH_PREFIXES.some((p) => pathMatchesPrefix(pathname, p))) return "controls";
  if (REPORTS_PATH_PREFIXES.some((p) => pathMatchesPrefix(pathname, p))) return "reports";
  if (SYSTEM_PATH_PREFIXES.some((p) => pathMatchesPrefix(pathname, p))) return "system";
  if (FINANCE_PATH_PREFIXES.some((p) => pathMatchesPrefix(pathname, p))) return "finance";
  return null;
}

export function navItemVisible(item: NavItemDef, isAdmin: boolean, permissionKeys: string[]): boolean {
  if (item.adminOnly && !isAdmin) return false;
  if (isAdmin) return true;
  if (!item.anyOf?.length) return true;
  return item.anyOf.some((k) => permissionKeys.includes(k));
}

export function filterSidebarGroups(isAdmin: boolean, permissionKeys: string[]): NavGroupDef[] {
  return SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((it) => navItemVisible(it, isAdmin, permissionKeys)),
  })).filter((g) => g.items.length > 0);
}

export function filterSidebarHome(isAdmin: boolean, permissionKeys: string[]): NavItemDef | null {
  return navItemVisible(SIDEBAR_HOME_ITEM, isAdmin, permissionKeys) ? SIDEBAR_HOME_ITEM : null;
}

/** @deprecated — השתמשו ב-filterSidebarGroups */
export function filterSidebarSections(isAdmin: boolean, permissionKeys: string[]): NavSectionDef[] {
  const home = filterSidebarHome(isAdmin, permissionKeys);
  const groups = filterSidebarGroups(isAdmin, permissionKeys);
  const sections: NavSectionDef[] = [];
  if (home) sections.push({ title: "ראשי", items: [home] });
  for (const g of groups) sections.push({ title: g.label, items: g.items });
  return sections;
}

/** כל פריטי הניווט (ל-audit) */
export function allSidebarNavItems(): NavItemDef[] {
  return [SIDEBAR_HOME_ITEM, ...SIDEBAR_GROUPS.flatMap((g) => g.items)];
}
