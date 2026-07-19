import { Prisma, type PaymentAdjustmentReason, type PaymentAdjustmentStatus } from "@prisma/client";

/**
 * שורת תשלום עודף שנרשמה לקופה בלי יתרת זכות (אחרי בחירת «הוסף לעמלות»).
 * נספרת בבקרת קופה; לא נספרת ביתרת לקוח / יתרת זכות.
 */
export const PAYMENT_ADJUSTMENT_FEE_NOTE_PREFIX = "הפרש התאמה — עמלה מתשלום";

export function isPaymentAdjustmentFeePayment(
  businessType: string | null | undefined,
): boolean {
  return businessType === "ADJUSTMENT_FEE";
}

/** סינון Prisma — לא לספור עמלות התאמה ביתרת לקוח */
export const customerBalanceExcludeAdjustmentFeePaymentsWhere = {
  NOT: {
    businessType: "ADJUSTMENT_FEE",
  },
} satisfies Prisma.PaymentWhereInput;

export const PAYMENT_ADJUSTMENT_REASON_LABELS: Record<PaymentAdjustmentReason, string> = {
  PAYMENT_SURPLUS: "הפרש תשלום",
  METHOD_DEVIATION: "חריגת אמצעי תשלום",
  BANK_FEE: "עמלת בנק",
  FX_DIFF: "הפרש שער",
  ROUNDING: "עיגול",
  MANUAL_ADJUST: "התאמה ידנית",
  OTHER: "אחר",
};

export const PAYMENT_ADJUSTMENT_STATUS_LABELS: Record<PaymentAdjustmentStatus, string> = {
  OPEN: "פתוח",
  CLOSED: "נסגר",
  CANCELLED: "בוטל",
};

function toDec(v: Prisma.Decimal | number | string): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(String(v));
}

export type CreatePaymentAdjustmentFeeInput = {
  customerId: string;
  orderId?: string | null;
  paymentId?: string | null;
  paymentCaptureCode?: string | null;
  sourceDocumentCode?: string | null;
  paymentMethod?: string | null;
  amountUsd: Prisma.Decimal | number | string;
  amountIls?: Prisma.Decimal | number | string | null;
  reason?: PaymentAdjustmentReason;
  status?: PaymentAdjustmentStatus;
  notes?: string | null;
  userChoice?: string | null;
  createdById?: string | null;
};

export function buildPaymentAdjustmentFeeCreateData(
  input: CreatePaymentAdjustmentFeeInput,
): Prisma.PaymentAdjustmentFeeUncheckedCreateInput {
  return {
    customerId: input.customerId,
    orderId: input.orderId ?? null,
    paymentId: input.paymentId ?? null,
    paymentCaptureCode: input.paymentCaptureCode ?? null,
    sourceDocumentCode: input.sourceDocumentCode ?? null,
    paymentMethod: input.paymentMethod ?? null,
    amountUsd: toDec(input.amountUsd),
    amountIls: input.amountIls == null || input.amountIls === "" ? null : toDec(input.amountIls),
    reason: input.reason ?? "PAYMENT_SURPLUS",
    status: input.status ?? "OPEN",
    notes: input.notes ?? null,
    userChoice: input.userChoice ?? null,
    createdById: input.createdById ?? null,
  };
}
