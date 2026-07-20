/**
 * מסנן קליטות תשלום לבקרת קופה — מקור אמת יחיד.
 *
 * שיוך לשבוע קופה:
 * 1. אם קיים Payment.intakeDate — לפי טווח תאריכי שבוע AH של תאריך הביצוע.
 * 2. אחרת (רשומות ישנות) — לפי Payment.weekCode (התנהגות היסטורית).
 *
 * עמודת היום בתוך השבוע: paymentDayKeyJerusalem (intakeDate ?? paymentDate ?? createdAt).
 */

import type { Prisma } from "@prisma/client";
import type { CashReconciliationLineId } from "@/lib/cash-control-reconciliation";
import { cashControlExcludeInternalPaymentsWhere } from "@/lib/cash-control-internal-payments";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { addDaysYmd, getAhWeekRange } from "@/lib/weeks/ah-week";
import { parseLocalDate } from "@/lib/work-week";

const CREDIT_METHODS = ["CREDIT", "CREDIT_CARD", "CARD"];
const BANK_METHODS = ["BANK_TRANSFER", "TRANSFER", "BANK"];
const CHECK_METHODS = ["CHECK", "CHECKS", "CHEQUE"];

/**
 * חברות בשבוע בקרת קופה לפי תאריך ביצוע קליטה (או weekCode לרשומות ללא intakeDate).
 */
export function cashControlWeekMembershipWhere(week: string): Prisma.PaymentWhereInput {
  const wk = week.trim();
  const range = getAhWeekRange(wk);
  if (!range) {
    return { weekCode: wk };
  }
  const gte = parseLocalDate(range.from);
  const lt = parseLocalDate(addDaysYmd(range.to, 1));
  return {
    OR: [
      { intakeDate: { gte, lt } },
      {
        AND: [{ intakeDate: null }, { weekCode: wk }],
      },
    ],
  };
}

/** כל קליטות התשלום הפעילות בשבוע העבודה */
export function cashControlWeekPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  return {
    AND: [
      activePaidPaymentWhere,
      cashControlWeekMembershipWhere(week),
      { amountUsd: { not: null } },
      cashControlExcludeInternalPaymentsWhere,
    ],
  };
}

/** כל קליטות התשלום הפעילות בשבוע — להתאמת קופה (כולל ₪ בלבד) */
export function cashControlWeekReconciliationPaymentsWhere(week: string): Prisma.PaymentWhereInput {
  return {
    AND: [
      activePaidPaymentWhere,
      cashControlWeekMembershipWhere(week),
      cashControlExcludeInternalPaymentsWhere,
    ],
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
      cashControlWeekMembershipWhere(week),
      { [methodField]: "CASH" },
      cashControlExcludeInternalPaymentsWhere,
    ],
  };
}
