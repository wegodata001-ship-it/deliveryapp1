/**
 * מסנן קליטות תשלום לבקרת קופה — מקור אמת יחיד.
 * קליטות נשמרות עם Payment.weekCode; הבקרה חייבת לסנן לפי אותו שדה.
 */

import type { Prisma } from "@prisma/client";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";

/** כל קליטות התשלום הפעילות בשבוע העבודה (לפי weekCode בשורת Payment) */
export function cashControlWeekPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  const wk = week.trim();
  return {
    AND: [activePaidPaymentWhere, { weekCode: wk }, { amountUsd: { not: null } }],
  };
}

/** קליטות מזומן בשבוע — לזרם הקופה (₪ / $) */
export function cashControlWeekCashPaymentsWhere(
  week: string,
  currency: "ILS" | "USD",
): Prisma.PaymentWhereInput {
  const methodField = currency === "ILS" ? "ilsPaymentMethod" : "usdPaymentMethod";
  return {
    AND: [activePaidPaymentWhere, { weekCode: week.trim() }, { [methodField]: "CASH" }],
  };
}
