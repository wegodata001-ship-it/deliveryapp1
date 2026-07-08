import type { Prisma } from "@prisma/client";
import { BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL } from "@/lib/commission-debt-closure";

/** עודף שנשמר כיתרת זכות — לא כסף שנכנס לקופה */
export const CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX = "יתרת זכות ללקוח — עודף מתשלום";

/** תשלומי חשבונאות פנימיים — לא נספרים בבקרת קופה */
export function isInternalNonReceiptPayment(notes: string | null | undefined): boolean {
  const n = (notes ?? "").trim();
  if (!n) return false;
  if (n.includes(BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL)) return true;
  if (n.startsWith(CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX)) return true;
  return false;
}

/** מסנן Prisma — להוספה ל-AND של שאילתות בקרת קופה */
export const cashControlExcludeInternalPaymentsWhere = {
  NOT: {
    OR: [
      { notes: { contains: BALANCE_RESET_FROM_CREDIT_LEDGER_LABEL } },
      { notes: { startsWith: CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } },
    ],
  },
} satisfies Prisma.PaymentWhereInput;
