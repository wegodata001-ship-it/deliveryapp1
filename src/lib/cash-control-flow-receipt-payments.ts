/**
 * מסנן קליטות לתזרים — תקבולים בפועל בלבד (לא רשומות פנימיות / עמלות התאמה).
 */
import type { Prisma } from "@prisma/client";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import {
  cashControlExcludeInternalPaymentsWhere,
  isInternalNonReceiptPayment,
} from "@/lib/cash-control-internal-payments";
import { cashControlWeekMembershipWhere } from "@/lib/cash-control-week-payments";

/** businessType שלא נספר כ«כסף שהתקבל» בבקרת תזרים */
export const FLOW_NON_RECEIPT_BUSINESS_TYPES = [
  "CUSTOMER_CREDIT",
  "CREDIT_APPLICATION",
  "BALANCE_RESET",
  "ADJUSTMENT_FEE",
] as const;

export function isFlowNonReceiptPayment(
  businessType: string | null | undefined,
): boolean {
  if (isInternalNonReceiptPayment(businessType)) return true;
  return businessType === "ADJUSTMENT_FEE";
}

/** Prisma — קליטות פעילות לשבוע קופה שמייצגות תקבול בפועל */
export function cashControlFlowReceiptPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  return {
    AND: [
      activePaidPaymentWhere,
      cashControlWeekMembershipWhere(week),
      cashControlExcludeInternalPaymentsWhere,
      { NOT: { businessType: { in: [...FLOW_NON_RECEIPT_BUSINESS_TYPES] } } },
    ],
  };
}
