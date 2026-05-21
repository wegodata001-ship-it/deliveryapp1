/** ערכי סטטוס מערכת (לשמירה ב-DB כמחרוזת) — תואם enum לשעבר */
export const OS = {
  OPEN: "OPEN",
  CANCELLED: "CANCELLED",
  WAITING_FOR_EXECUTION: "WAITING_FOR_EXECUTION",
  WITHDRAWAL_FROM_SUPPLIER: "WITHDRAWAL_FROM_SUPPLIER",
  SENT: "SENT",
  WAITING_FOR_CHINA_EXECUTION: "WAITING_FOR_CHINA_EXECUTION",
  COMPLETED: "COMPLETED",
  DEBT_WITHDRAWAL: "DEBT_WITHDRAWAL",
} as const;

export type OrderStatusValue = string;

export const LEGACY_ORDER_STATUS_SLUGS: readonly string[] = Object.values(OS);

export function isLegacyOrderStatusSlug(id: string): boolean {
  return (LEGACY_ORDER_STATUS_SLUGS as readonly string[]).includes(id);
}
