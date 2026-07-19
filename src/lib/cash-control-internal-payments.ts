import type { PaymentBusinessType, Prisma } from "@prisma/client";

/** עודף שנשמר כיתרת זכות — לא כסף שנכנס לקופה */
export const CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX = "יתרת זכות ללקוח — עודף מתשלום";

/** תשלומי חשבונאות פנימיים — לא נספרים בבקרת קופה */
export function isInternalNonReceiptPayment(
  businessType: PaymentBusinessType | string | null | undefined,
): boolean {
  return (
    businessType === "CUSTOMER_CREDIT" ||
    businessType === "CREDIT_APPLICATION" ||
    businessType === "BALANCE_RESET"
  );
}

/** מסנן Prisma — להוספה ל-AND של שאילתות בקרת קופה */
export const cashControlExcludeInternalPaymentsWhere = {
  NOT: {
    businessType: { in: ["CUSTOMER_CREDIT", "CREDIT_APPLICATION", "BALANCE_RESET"] },
  },
} satisfies Prisma.PaymentWhereInput;
