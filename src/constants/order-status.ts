import { OrderStatus } from "@prisma/client";

export type OrderStatusColor = "blue" | "orange" | "green" | "red" | "purple" | "muted";

export type OrderStatusKpiBucket = "open" | "in_progress" | "ready" | "cancelled" | "debt_withdrawal";

export type OrderStatusMeta = {
  value: OrderStatus;
  /** תצוגה אחידה — רשימה, badges, PDF, דוחות */
  label: string;
  /** תווית ב-dropdown עריכה (כל ערכי ה-enum) */
  editLabel: string;
  color: OrderStatusColor;
  badgeClass: string;
  tableClass: string;
  kpiBucket: OrderStatusKpiBucket;
};

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  [OrderStatus.OPEN]: {
    value: OrderStatus.OPEN,
    label: "פתוחה",
    editLabel: "פתוחה",
    color: "blue",
    badgeClass: "adm-badge-sel--open",
    tableClass: "adm-ord-st adm-ord-st--open",
    kpiBucket: "open",
  },
  [OrderStatus.WAITING_FOR_EXECUTION]: {
    value: OrderStatus.WAITING_FOR_EXECUTION,
    label: "בטיפול",
    editLabel: "בטיפול",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OrderStatus.WITHDRAWAL_FROM_SUPPLIER]: {
    value: OrderStatus.WITHDRAWAL_FROM_SUPPLIER,
    label: "בטיפול",
    editLabel: "משיכה מספק",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OrderStatus.SENT]: {
    value: OrderStatus.SENT,
    label: "בטיפול",
    editLabel: "נשלחה",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OrderStatus.WAITING_FOR_CHINA_EXECUTION]: {
    value: OrderStatus.WAITING_FOR_CHINA_EXECUTION,
    label: "בטיפול",
    editLabel: "ממתין לסין",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OrderStatus.COMPLETED]: {
    value: OrderStatus.COMPLETED,
    label: "מוכן",
    editLabel: "מוכן",
    color: "green",
    badgeClass: "adm-badge-sel--success",
    tableClass: "adm-ord-st adm-ord-st--done",
    kpiBucket: "ready",
  },
  [OrderStatus.CANCELLED]: {
    value: OrderStatus.CANCELLED,
    label: "מבוטל",
    editLabel: "מבוטל",
    color: "red",
    badgeClass: "adm-badge-sel--cancelled",
    tableClass: "adm-ord-st adm-ord-st--muted",
    kpiBucket: "cancelled",
  },
  [OrderStatus.DEBT_WITHDRAWAL]: {
    value: OrderStatus.DEBT_WITHDRAWAL,
    label: "משיכה מהחוב",
    editLabel: "משיכה מהחוב",
    color: "purple",
    badgeClass: "adm-badge-sel--withdrawal",
    tableClass: "adm-ord-st adm-ord-st--muted",
    kpiBucket: "debt_withdrawal",
  },
};

/** כל הסטטוסים — מקור יחיד לתצוגה */
export const ORDER_STATUSES: OrderStatusMeta[] = (Object.values(OrderStatus) as OrderStatus[]).map(
  (value) => ORDER_STATUS_META[value],
);

/** Dropdown מהיר: רשימת הזמנות + קליטת הזמנה (יצירה) */
export const ORDER_STATUS_QUICK_SELECT_OPTIONS = (
  [
    OrderStatus.OPEN,
    OrderStatus.WAITING_FOR_EXECUTION,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
    OrderStatus.DEBT_WITHDRAWAL,
  ] as const
).map((value) => ({
  value,
  label: ORDER_STATUS_META[value].label,
}));

/** Dropdown מלא — עריכת הזמנה (כל ערכי DB) */
export const ORDER_STATUS_EDIT_SELECT_OPTIONS = (Object.values(OrderStatus) as OrderStatus[]).map(
  (value) => ({
    value,
    label: ORDER_STATUS_META[value].editLabel,
  }),
);

export function getOrderStatusMeta(status: string): OrderStatusMeta {
  if (status in ORDER_STATUS_META) return ORDER_STATUS_META[status as OrderStatus];
  return {
    value: OrderStatus.OPEN,
    label: status,
    editLabel: status,
    color: "muted",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--muted",
    kpiBucket: "in_progress",
  };
}

export function getOrderStatusLabel(status: string): string {
  return getOrderStatusMeta(status).label;
}

/** ערך ל-select בשורה / סינון — ממפה מצבי ביניים ל"בטיפול" */
export function orderStatusToQuickSelectValue(status: string): OrderStatus {
  if (
    status === OrderStatus.OPEN ||
    status === OrderStatus.COMPLETED ||
    status === OrderStatus.CANCELLED ||
    status === OrderStatus.DEBT_WITHDRAWAL
  ) {
    return status;
  }
  if (
    status === OrderStatus.WAITING_FOR_EXECUTION ||
    status === OrderStatus.SENT ||
    status === OrderStatus.WAITING_FOR_CHINA_EXECUTION ||
    status === OrderStatus.WITHDRAWAL_FROM_SUPPLIER
  ) {
    return OrderStatus.WAITING_FOR_EXECUTION;
  }
  return OrderStatus.WAITING_FOR_EXECUTION;
}

export function inlineStatusBadgeClass(sel: OrderStatus): string {
  return getOrderStatusMeta(sel).badgeClass;
}

export function orderBusinessStatusDisplay(status: string): { label: string; className: string } {
  const m = getOrderStatusMeta(status);
  return { label: m.label, className: m.tableClass };
}

export function orderSensitiveStatusHe(status: OrderStatus): string {
  return getOrderStatusLabel(status);
}

export function orderStatusLabelByEditText(editLabel: string): OrderStatus | null {
  const t = editLabel.trim();
  const hit = (Object.values(OrderStatus) as OrderStatus[]).find(
    (s) => ORDER_STATUS_META[s].editLabel === t || ORDER_STATUS_META[s].label === t,
  );
  return hit ?? null;
}

export function buildOrderStatusLabelRecord(): Record<OrderStatus, string> {
  return Object.fromEntries(
    (Object.values(OrderStatus) as OrderStatus[]).map((s) => [s, ORDER_STATUS_META[s].label]),
  ) as Record<OrderStatus, string>;
}
