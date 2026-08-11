/** סטטוס איזון שבוע בבקרת קופה */
export type WeekBalanceStatus = "OPEN" | "NEEDS_BALANCE" | "READY" | "BALANCED";

export type WeekBalanceCurrencySnapshot = {
  currency: "ILS" | "USD";
  income: number;
  expenses: number;
  expected: number;
  counted: number;
  diff: number;
};

export type WeekBalanceSnapshot = {
  weekCode: string;
  ils: WeekBalanceCurrencySnapshot;
  usd: WeekBalanceCurrencySnapshot;
  hasPendingCounts: boolean;
  dataHash: string;
};

export type WeekBalanceStateDto = {
  weekCode: string;
  weekLabel: string | null;
  status: WeekBalanceStatus;
  statusLabel: string;
  snapshot: WeekBalanceSnapshot;
  canConfirm: boolean;
  balancedAtIso: string | null;
  balancedByName: string | null;
  isBalanced: boolean;
};

export const WEEK_BALANCE_STATUS_LABELS: Record<WeekBalanceStatus, string> = {
  OPEN: "פתוח",
  NEEDS_BALANCE: "דורש איזון",
  READY: "מוכן לאיזון",
  BALANCED: "מאוזן ✓",
};
