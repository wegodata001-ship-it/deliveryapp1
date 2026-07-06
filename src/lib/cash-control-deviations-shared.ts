/** טיפוסים ועזרי תצוגה לחריגות בקרת קופה — ניתן לייבא מ-Client. */

export type CashControlDeviationType = "method" | "amount" | "rate" | "week";

export type CashControlDeviationStatus = "open" | "approved" | "cancelled";

export type CashControlMethodLineStatus = "ok" | "shortfall" | "excess";

export type CashControlDeviationMethodLine = {
  method: string;
  methodLabel: string;
  plannedUsd: string;
  receivedUsd: string;
  remainingUsd: string;
  /** סכום חריגה — null כשאין */
  deviationUsd: string | null;
  lineStatus: CashControlMethodLineStatus;
};

export type CashControlDeviationRow = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  orderWeekCode: string;
  paymentId: string | null;
  paymentCode: string | null;
  deviationType: CashControlDeviationType;
  typeLabel: string;
  methodLabel: string | null;
  allowedUsd: string;
  receivedUsd: string;
  deviationUsd: string;
  status: CashControlDeviationStatus;
  intakeDateYmd: string | null;
  intakeDateKey: string | null;
  intakeUserName: string | null;
  customerId: string | null;
  customerName: string | null;
  /** חלוקת אמצעי תשלום מתוכננת מול בפועל (הזמנות מורכבות) */
  methodBreakdown: CashControlDeviationMethodLine[];
};

const TYPE_ICON: Record<CashControlDeviationType, string> = {
  method: "🟠",
  amount: "🔴",
  rate: "🟡",
  week: "🔵",
};

export function cashControlDeviationTypeIcon(t: CashControlDeviationType): string {
  return TYPE_ICON[t];
}

export function cashControlMethodLineStatusLabel(s: CashControlMethodLineStatus): string {
  if (s === "excess") return "חריגה";
  if (s === "shortfall") return "חסר";
  return "תקין";
}
