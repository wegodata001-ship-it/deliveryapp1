/**
 * מטא-דאטה לסטטוסי הזמנה (צבעים, KPI, מחלקות CSS).
 * שמות תצוגה — מטבלת SourceStatus (ראו order-status-registry.ts).
 */
import { LEGACY_ORDER_STATUS_SLUGS, OS } from "@/lib/order-status-slugs";

export type OrderStatusColor = "blue" | "orange" | "green" | "red" | "purple" | "muted";

export type OrderStatusKpiBucket = "open" | "in_progress" | "ready" | "cancelled" | "debt_withdrawal";

export type OrderStatusMeta = {
  value: string;
  label: string;
  editLabel: string;
  color: OrderStatusColor;
  badgeClass: string;
  tableClass: string;
  kpiBucket: OrderStatusKpiBucket;
};

export const ORDER_STATUS_META: Record<string, OrderStatusMeta> = {
  [OS.OPEN]: {
    value: OS.OPEN,
    label: "פתוחה",
    editLabel: "פתוחה",
    color: "blue",
    badgeClass: "adm-badge-sel--open",
    tableClass: "adm-ord-st adm-ord-st--open",
    kpiBucket: "open",
  },
  [OS.WAITING_FOR_EXECUTION]: {
    value: OS.WAITING_FOR_EXECUTION,
    label: "ממתין לביצוע",
    editLabel: "ממתין לביצוע",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OS.WITHDRAWAL_FROM_SUPPLIER]: {
    value: OS.WITHDRAWAL_FROM_SUPPLIER,
    label: "ממתין לביצוע",
    editLabel: "ממתין לביצוע",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OS.SENT]: {
    value: OS.SENT,
    label: "ממתין לביצוע",
    editLabel: "ממתין לביצוע",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OS.WAITING_FOR_CHINA_EXECUTION]: {
    value: OS.WAITING_FOR_CHINA_EXECUTION,
    label: "ממתין לביצוע",
    editLabel: "ממתין לביצוע",
    color: "orange",
    badgeClass: "adm-badge-sel--warning",
    tableClass: "adm-ord-st adm-ord-st--progress",
    kpiBucket: "in_progress",
  },
  [OS.COMPLETED]: {
    value: OS.COMPLETED,
    label: "בוצע",
    editLabel: "בוצע",
    color: "green",
    badgeClass: "adm-badge-sel--success",
    tableClass: "adm-ord-st adm-ord-st--done",
    kpiBucket: "ready",
  },
  [OS.CANCELLED]: {
    value: OS.CANCELLED,
    label: "מבוטל",
    editLabel: "מבוטל",
    color: "red",
    badgeClass: "adm-badge-sel--cancelled",
    tableClass: "adm-ord-st adm-ord-st--muted",
    kpiBucket: "cancelled",
  },
  [OS.DEBT_WITHDRAWAL]: {
    value: OS.DEBT_WITHDRAWAL,
    label: "משיכה מחוב",
    editLabel: "משיכה מחוב",
    color: "purple",
    badgeClass: "adm-badge-sel--withdrawal",
    tableClass: "adm-ord-st adm-ord-st--muted",
    kpiBucket: "debt_withdrawal",
  },
};

export const ORDER_STATUSES: OrderStatusMeta[] = LEGACY_ORDER_STATUS_SLUGS.map((value) => ORDER_STATUS_META[value]);

export const ORDER_STATUS_QUICK_SELECT_OPTIONS = (
  [OS.OPEN, OS.WAITING_FOR_EXECUTION, OS.COMPLETED, OS.CANCELLED, OS.DEBT_WITHDRAWAL] as const
).map((value) => ({
  value,
  label: ORDER_STATUS_META[value].label,
}));

export const ORDER_STATUS_EDIT_SELECT_OPTIONS = LEGACY_ORDER_STATUS_SLUGS.map((value) => ({
  value,
  label: ORDER_STATUS_META[value].editLabel,
}));

export function getOrderStatusMeta(status: string): OrderStatusMeta {
  if (status in ORDER_STATUS_META) return ORDER_STATUS_META[status];
  return {
    value: status,
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

/** תווית אחידה ל-5 סטטוסים רשמיים (כולל מיפוי legacy) */
export function getOfficialOrderStatusDisplayLabel(status: string): string {
  if (status === OS.DEBT_WITHDRAWAL) return "משיכה מחוב";
  const quick = orderStatusToQuickSelectValue(status);
  if (quick in ORDER_STATUS_META) return ORDER_STATUS_META[quick].label;
  return getOrderStatusLabel(status);
}

export function orderStatusToQuickSelectValue(status: string): string {
  if (
    status === OS.OPEN ||
    status === OS.COMPLETED ||
    status === OS.CANCELLED ||
    status === OS.DEBT_WITHDRAWAL
  ) {
    return status;
  }
  if (
    status === OS.WAITING_FOR_EXECUTION ||
    status === OS.SENT ||
    status === OS.WAITING_FOR_CHINA_EXECUTION ||
    status === OS.WITHDRAWAL_FROM_SUPPLIER
  ) {
    return OS.WAITING_FOR_EXECUTION;
  }
  return status;
}

export function inlineStatusBadgeClass(sel: string): string {
  return getOrderStatusMeta(sel).badgeClass;
}

export function orderBusinessStatusDisplay(status: string): { label: string; className: string } {
  const m = getOrderStatusMeta(status);
  return { label: m.label, className: m.tableClass };
}

/** Full-row background in orders list — keyed by KPI bucket, not payment method. */
export function orderListRowToneClass(status: string): string {
  switch (getOrderStatusMeta(status).kpiBucket) {
    case "in_progress":
      return "adm-order-row--progress";
    case "ready":
      return "adm-order-row--ready";
    case "cancelled":
      return "adm-order-row--cancelled";
    case "debt_withdrawal":
      return "adm-order-row--withdrawal";
    default:
      return "adm-order-row--open";
  }
}

export function orderSensitiveStatusHe(status: string): string {
  return getOrderStatusLabel(status);
}

export function orderStatusLabelByEditText(editLabel: string): string | null {
  const t = editLabel.trim();
  const hit = LEGACY_ORDER_STATUS_SLUGS.find(
    (s) => ORDER_STATUS_META[s].editLabel === t || ORDER_STATUS_META[s].label === t,
  );
  return hit ?? null;
}

export function buildOrderStatusLabelRecord(): Record<string, string> {
  return Object.fromEntries(LEGACY_ORDER_STATUS_SLUGS.map((s) => [s, ORDER_STATUS_META[s].label]));
}

/** סטטוסים שדורשים אישור מנהל לעריכה */
export function isLockedOrderStatus(status: string): boolean {
  return status === OS.COMPLETED || status === OS.CANCELLED;
}

export function isDebtWithdrawalStatus(status: string): boolean {
  return status === OS.DEBT_WITHDRAWAL;
}
