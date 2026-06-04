import type { CustomerBalanceOrderStatusFilter } from "@/lib/customer-balance-order-status-filter";

/** תואם CustomerBalanceDebtFilter ב-actions (ערכי סינון מהיר בלבד) */
export type QuickFilterDebtStatus = "ALL" | "OWES" | "CREDIT";

/** סינון מהיר — KPI + dropdown */
export type BalancesQuickFilter =
  | "ALL"
  | "OWES"
  | "CREDIT"
  | "OPEN"
  | "READY"
  | "IN_PROGRESS"
  | "CANCELLED"
  | "DEBT_WITHDRAWAL"
  | "HAS_PAYMENTS";

export const BALANCES_QUICK_FILTER_OPTIONS: { value: BalancesQuickFilter; label: string }[] = [
  { value: "ALL", label: "הכל" },
  { value: "OWES", label: "לקוחות בחוב" },
  { value: "CREDIT", label: "לקוחות בזכות" },
  { value: "READY", label: "מוכן" },
  { value: "OPEN", label: "פתוח" },
  { value: "IN_PROGRESS", label: "בטיפול" },
  { value: "CANCELLED", label: "מבוטל" },
  { value: "DEBT_WITHDRAWAL", label: 'משיכה מחו"ל' },
];

const QUICK_VALUES = new Set<BalancesQuickFilter>(BALANCES_QUICK_FILTER_OPTIONS.map((o) => o.value));

export function parseBalancesQuickFilter(raw: string | undefined | null): BalancesQuickFilter {
  const t = (raw ?? "").trim().toUpperCase() as BalancesQuickFilter;
  return QUICK_VALUES.has(t) ? t : "ALL";
}

export type QuickFilterQueryParts = {
  balanceDebtStatus: QuickFilterDebtStatus;
  orderStatus: CustomerBalanceOrderStatusFilter;
  hasPayments?: boolean;
};

export function quickFilterToQueryParts(filter: BalancesQuickFilter): QuickFilterQueryParts {
  switch (filter) {
    case "OWES":
      return { balanceDebtStatus: "OWES", orderStatus: "ALL" };
    case "CREDIT":
      return { balanceDebtStatus: "CREDIT", orderStatus: "ALL" };
    case "OPEN":
      return { balanceDebtStatus: "ALL", orderStatus: "OPEN" };
    case "READY":
      return { balanceDebtStatus: "ALL", orderStatus: "COMPLETED" };
    case "IN_PROGRESS":
      return { balanceDebtStatus: "ALL", orderStatus: "IN_PROGRESS" };
    case "CANCELLED":
      return { balanceDebtStatus: "ALL", orderStatus: "CANCELLED" };
    case "DEBT_WITHDRAWAL":
      return { balanceDebtStatus: "ALL", orderStatus: "DEBT_WITHDRAWAL" };
    case "HAS_PAYMENTS":
      return { balanceDebtStatus: "ALL", orderStatus: "ALL", hasPayments: true };
    default:
      return { balanceDebtStatus: "ALL", orderStatus: "ALL" };
  }
}

/** מיפוי חזרה ל-KPI פעיל (רק מסנני KPI לחיצים) */
export function quickFilterFromQueryParts(parts: QuickFilterQueryParts): BalancesQuickFilter {
  if (parts.hasPayments) return "HAS_PAYMENTS";
  if (parts.orderStatus === "IN_PROGRESS") return "IN_PROGRESS";
  if (parts.orderStatus === "DEBT_WITHDRAWAL") return "DEBT_WITHDRAWAL";
  if (parts.balanceDebtStatus === "OWES" && parts.orderStatus === "ALL") return "OWES";
  if (parts.balanceDebtStatus === "CREDIT" && parts.orderStatus === "ALL") return "CREDIT";
  if (parts.orderStatus === "OPEN") return "OPEN";
  if (parts.orderStatus === "COMPLETED") return "READY";
  if (parts.orderStatus === "CANCELLED") return "CANCELLED";
  if (parts.balanceDebtStatus === "ALL" && parts.orderStatus === "ALL") return "ALL";
  return "ALL";
}

export type BalancesKpiFilterKey = "OWES" | "CREDIT" | "IN_PROGRESS" | "DEBT_WITHDRAWAL" | "HAS_PAYMENTS";

export function kpiKeyToQuickFilter(key: BalancesKpiFilterKey): BalancesQuickFilter {
  return key;
}
