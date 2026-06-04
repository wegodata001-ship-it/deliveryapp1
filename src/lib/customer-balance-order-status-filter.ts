import { OS } from "@/lib/order-status-slugs";

/** סינון יתרות לפי סטטוס הזמנה (DB) */
export type CustomerBalanceOrderStatusFilter =
  | "ALL"
  | "OPEN"
  | "COMPLETED"
  | "IN_PROGRESS"
  | "CANCELLED"
  | "DEBT_WITHDRAWAL";

export const CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS: {
  value: CustomerBalanceOrderStatusFilter;
  label: string;
}[] = [
  { value: "ALL", label: "הכל" },
  { value: "OPEN", label: "פתוח" },
  { value: "COMPLETED", label: "מוכן" },
  { value: "IN_PROGRESS", label: "בטיפול" },
  { value: "CANCELLED", label: "מבוטל" },
  { value: "DEBT_WITHDRAWAL", label: 'משיכה מחו"ל' },
];

const FILTER_VALUES = new Set<CustomerBalanceOrderStatusFilter>(
  CUSTOMER_BALANCE_ORDER_STATUS_OPTIONS.map((o) => o.value),
);

export function parseCustomerBalanceOrderStatusFilter(
  raw: string | undefined | null,
): CustomerBalanceOrderStatusFilter {
  const t = (raw ?? "").trim().toUpperCase() as CustomerBalanceOrderStatusFilter;
  return FILTER_VALUES.has(t) ? t : "ALL";
}

/** ערכי status ב-DB — null = כל הסטטוסים */
export function orderStatusesForBalanceFilter(
  filter: CustomerBalanceOrderStatusFilter,
): string[] | null {
  if (filter === "ALL") return null;
  if (filter === "OPEN") return [OS.OPEN];
  if (filter === "COMPLETED") return [OS.COMPLETED];
  if (filter === "CANCELLED") return [OS.CANCELLED];
  if (filter === "DEBT_WITHDRAWAL") return [OS.DEBT_WITHDRAWAL];
  return [
    OS.WAITING_FOR_EXECUTION,
    OS.WITHDRAWAL_FROM_SUPPLIER,
    OS.SENT,
    OS.WAITING_FOR_CHINA_EXECUTION,
  ];
}

export type StatusBalanceKpiKey = "open" | "ready" | "inProgress" | "debtWithdrawal";

export const STATUS_BALANCE_KPI_SPECS: {
  key: StatusBalanceKpiKey;
  filter: CustomerBalanceOrderStatusFilter;
  label: string;
}[] = [
  { key: "open", filter: "OPEN", label: "יתרות פתוח" },
  { key: "ready", filter: "COMPLETED", label: "יתרות מוכן" },
  { key: "inProgress", filter: "IN_PROGRESS", label: "יתרות בטיפול" },
  { key: "debtWithdrawal", filter: "DEBT_WITHDRAWAL", label: 'יתרות משיכה מחו"ל' },
];
