/**
 * מסנן קליטות תשלום לבקרת קופה — מקור אמת יחיד.
 * קליטות נשמרות עם Payment.weekCode; הבקרה חייבת לסנן לפי אותו שדה.
 */

import type { Prisma } from "@prisma/client";
import type { CashReconciliationLineId } from "@/lib/cash-control-reconciliation";
import { cashControlExcludeInternalPaymentsWhere } from "@/lib/cash-control-internal-payments";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";

const CREDIT_METHODS = ["CREDIT", "CREDIT_CARD", "CARD"];
const BANK_METHODS = ["BANK_TRANSFER", "TRANSFER", "BANK"];
const CHECK_METHODS = ["CHECK", "CHECKS", "CHEQUE"];

/** כל קליטות התשלום הפעילות בשבוע העבודה (לפי weekCode בשורת Payment) */
export function cashControlWeekPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  const wk = week.trim();
  return {
    AND: [
      activePaidPaymentWhere,
      { weekCode: wk },
      { amountUsd: { not: null } },
      cashControlExcludeInternalPaymentsWhere,
    ],
  };
}

/** כל קליטות התשלום הפעילות בשבוע — להתאמת קופה (כולל ₪ בלבד) */
export function cashControlWeekReconciliationPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  return {
    AND: [activePaidPaymentWhere, { weekCode: week.trim() }, cashControlExcludeInternalPaymentsWhere],
  };
}

/** מסנן קליטות לפי שורת התאמה (לפירוט lazy) */
export function cashControlReconciliationLineWhere(
  week: string,
  lineId: CashReconciliationLineId,
): Prisma.PaymentWhereInput {
  const base = cashControlWeekReconciliationPaymentsWhere(week);
  switch (lineId) {
    case "CASH_ILS":
      return { AND: [base, { ilsPaymentMethod: "CASH" }] };
    case "CASH_USD":
      return {
        AND: [
          base,
          {
            OR: [
              { usdPaymentMethod: "CASH" },
              { AND: [{ paymentMethod: "CASH" }, { OR: [{ usdPaymentMethod: null }, { usdPaymentMethod: "" }] }] },
            ],
          },
        ],
      };
    case "CREDIT":
      return {
        AND: [
          base,
          {
            OR: [
              { ilsPaymentMethod: { in: CREDIT_METHODS } },
              { usdPaymentMethod: { in: CREDIT_METHODS } },
              { paymentMethod: { in: CREDIT_METHODS } },
            ],
          },
        ],
      };
    case "BANK_TRANSFER":
      return {
        AND: [
          base,
          {
            OR: [
              { ilsPaymentMethod: { in: BANK_METHODS } },
              { usdPaymentMethod: { in: BANK_METHODS } },
              { paymentMethod: { in: BANK_METHODS } },
            ],
          },
        ],
      };
    case "CHECK":
      return {
        AND: [
          base,
          {
            OR: [
              { ilsPaymentMethod: { in: CHECK_METHODS } },
              { usdPaymentMethod: { in: CHECK_METHODS } },
              { paymentMethod: { in: CHECK_METHODS } },
            ],
          },
        ],
      };
    default:
      return base;
  }
}

/** קליטות מזומן בשבוע — לזרם הקופה (₪ / $) */
export function cashControlWeekCashPaymentsWhere(
  week: string,
  currency: "ILS" | "USD",
): Prisma.PaymentWhereInput {
  const methodField = currency === "ILS" ? "ilsPaymentMethod" : "usdPaymentMethod";
  return {
    AND: [
      activePaidPaymentWhere,
      { weekCode: week.trim() },
      { [methodField]: "CASH" },
      cashControlExcludeInternalPaymentsWhere,
    ],
  };
}
