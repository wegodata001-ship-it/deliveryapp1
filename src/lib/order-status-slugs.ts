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

/** חמישה סטטוסים רשמיים בלבד — תצוגה ובחירה למשתמש */
export const OFFICIAL_ORDER_STATUS_IDS = [
  OS.OPEN,
  OS.WAITING_FOR_EXECUTION,
  OS.COMPLETED,
  OS.DEBT_WITHDRAWAL,
  OS.CANCELLED,
] as const;

export type OfficialOrderStatusId = (typeof OFFICIAL_ORDER_STATUS_IDS)[number];

/** סטטוסי-משנה ישנים — מוצגים כ״ממתין לביצוע״, לא ב-dropdown */
export const LEGACY_IN_PROGRESS_STATUS_IDS = [
  OS.WITHDRAWAL_FROM_SUPPLIER,
  OS.SENT,
  OS.WAITING_FOR_CHINA_EXECUTION,
] as const;

export function isLegacyOrderStatusSlug(id: string): boolean {
  return (LEGACY_ORDER_STATUS_SLUGS as readonly string[]).includes(id);
}

export function isOfficialOrderStatusId(id: string): id is OfficialOrderStatusId {
  return (OFFICIAL_ORDER_STATUS_IDS as readonly string[]).includes(id);
}
