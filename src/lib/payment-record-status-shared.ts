import type { Prisma } from "@prisma/client";

export const PAYMENT_RECORD_STATUS_ACTIVE = "ACTIVE" as const;
export const PAYMENT_RECORD_STATUS_CANCELLED = "CANCELLED" as const;

export type PaymentRecordStatus =
  | typeof PAYMENT_RECORD_STATUS_ACTIVE
  | typeof PAYMENT_RECORD_STATUS_CANCELLED;

/** תשלומים שסופרים ביתרות, דוחות וסיכומים (לא כולל מבוטלים) */
export const activePaidPaymentWhere = {
  isPaid: true,
  status: { not: PAYMENT_RECORD_STATUS_CANCELLED },
} satisfies Prisma.PaymentWhereInput;

/** גיבוי כש-Prisma Client בזיכרון עדיין ישן (לפני generate + הפעלה מחדש של dev) */
export const activePaidPaymentWhereLegacy = {
  isPaid: true,
} satisfies Prisma.PaymentWhereInput;
