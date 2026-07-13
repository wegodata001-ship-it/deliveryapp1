/** סטטוס חלוקת תשלום פעילה — מטא-דאטה; שורות ב-OrderPaymentBreakdown */
export type PaymentPlanStatus =
  | "ACTIVE"
  | "PARTIALLY_RECEIVED"
  | "COMPLETED"
  | "CANCELLED"
  | "REPLACED";

export type PaymentPlanClosureType = "BALANCE_RESET" | "CREDIT_BALANCE" | "PAYMENT_RECEIVED";

export type PaymentPlanIntakeSummary = {
  id: string;
  status: PaymentPlanStatus;
  sourceWeekCode: string | null;
  createdInWeekCode: string;
  updatedAtYmd: string;
  closureType: PaymentPlanClosureType | null;
};

export type PaymentPlanAuditAction =
  | "PAYMENT_PLAN_CREATED"
  | "PAYMENT_PLAN_UPDATED"
  | "PAYMENT_PLAN_LINE_RECEIVED"
  | "PAYMENT_PLAN_COMPLETED"
  | "PAYMENT_PLAN_CANCELLED"
  | "PAYMENT_PLAN_ROLLED_FORWARD";

export const PAYMENT_PLAN_ACTIVE_STATUSES: PaymentPlanStatus[] = ["ACTIVE", "PARTIALLY_RECEIVED"];

export function paymentPlanStatusLabelHe(status: PaymentPlanStatus): string {
  switch (status) {
    case "ACTIVE":
      return "פעיל";
    case "PARTIALLY_RECEIVED":
      return "נקלט חלקית";
    case "COMPLETED":
      return "הושלם";
    case "CANCELLED":
      return "בוטל";
    case "REPLACED":
      return "הוחלף";
    default:
      return status;
  }
}
