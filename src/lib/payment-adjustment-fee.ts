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

/** מקור העמלה — לתצוגה בטבלת עמלות */
export type PaymentFeeSourceKind =
  | "PAYMENT_INTAKE"
  | "PAYMENT_SURPLUS"
  | "BALANCE_RESET"
  | "MANUAL"
  | "CORRECTION"
  | "OTHER";

export const PAYMENT_FEE_SOURCE_LABELS: Record<PaymentFeeSourceKind, string> = {
  PAYMENT_INTAKE: "קליטת תשלום",
  PAYMENT_SURPLUS: "תשלום יתר",
  BALANCE_RESET: "איפוס יתרה",
  MANUAL: "הזנה ידנית",
  CORRECTION: "תיקון",
  OTHER: "אחר",
};

export type PaymentFeeAmountKind = "CREDIT" | "DEBIT";

export function derivePaymentFeeSourceKind(input: {
  reason: PaymentAdjustmentReason;
  userChoice: string | null | undefined;
  paymentId: string | null | undefined;
}): PaymentFeeSourceKind {
  const choice = (input.userChoice ?? "").trim();
  if (choice === "commission" || input.reason === "PAYMENT_SURPLUS") return "PAYMENT_SURPLUS";
  if (choice === "fee_adjustment_negative" || choice === "close_remainder_fee") return "BALANCE_RESET";
  if (input.reason === "MANUAL_ADJUST") return "MANUAL";
  if (
    input.reason === "METHOD_DEVIATION" ||
    input.reason === "BANK_FEE" ||
    input.reason === "FX_DIFF" ||
    input.reason === "ROUNDING"
  ) {
    return "CORRECTION";
  }
  if (input.paymentId) return "PAYMENT_INTAKE";
  return "OTHER";
}

export function derivePaymentFeeAmountKind(amountUsd: number): PaymentFeeAmountKind {
  return amountUsd < -0.001 ? "DEBIT" : "CREDIT";
}

export function derivePaymentFeeTypeLabel(amountUsd: number): string {
  return derivePaymentFeeAmountKind(amountUsd) === "DEBIT"
    ? "קיזוז / איפוס חוב"
    : "עמלה / זכות למערכת";
}

/** סכום חתום — לא Math.abs */
export function formatSignedUsdDisplay(amountUsd: number): string {
  const v = Number(amountUsd);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (v > 0.001) return `+$${abs}`;
  if (v < -0.001) return `-$${abs}`;
  return `$${abs}`;
}

export function derivePaymentFeeReasonLabel(input: {
  reason: PaymentAdjustmentReason;
  userChoice: string | null | undefined;
  sourceKind: PaymentFeeSourceKind;
}): string {
  if (input.sourceKind === "PAYMENT_SURPLUS") return "תשלום יתר";
  if (input.userChoice === "fee_adjustment_negative") return "איפוס חוב — עמלה שלילית";
  if (input.userChoice === "close_remainder_fee") return "סגירת יתרה";
  if (input.userChoice === "commission") return "תשלום יתר → עמלות";
  return PAYMENT_ADJUSTMENT_REASON_LABELS[input.reason] ?? input.reason;
}

export function isAutomaticPaymentFee(input: {
  paymentId: string | null | undefined;
  userChoice: string | null | undefined;
}): boolean {
  const choice = (input.userChoice ?? "").trim();
  return Boolean(input.paymentId) && choice !== "MANUAL_ADJUST" && choice !== "";
}

export function canEditPaymentFee(input: {
  status: PaymentAdjustmentStatus;
  isAutomatic: boolean;
}): boolean {
  return !input.isAutomatic && input.status === "OPEN";
}

export function canCancelPaymentFee(input: {
  status: PaymentAdjustmentStatus;
  isAutomatic: boolean;
}): boolean {
  return input.status !== "CANCELLED" && !input.isAutomatic;
}

export function buildBalanceResetFeeNotes(input: {
  debtBeforeUsd: number;
  paidUsd: number;
  resetUsd: number;
  feeUsd: number;
}): string {
  return [
    "איפוס יתרה — התאמת עמלה",
    `חוב לפני הפעולה: $${input.debtBeforeUsd.toFixed(2)}`,
    `שולם: $${input.paidUsd.toFixed(2)}`,
    `יתרה שאופסה: $${input.resetUsd.toFixed(2)}`,
    `עמלה שנוצרה: ${formatSignedUsdDisplay(input.feeUsd)}`,
  ].join("\n");
}

export function buildSurplusFeeNotes(input: {
  debtBeforeUsd: number;
  paymentUsd: number;
  surplusUsd: number;
  captureCode: string;
}): string {
  return [
    "תשלום יתר — העברה לעמלות",
    `חוב לפני הפעולה: $${input.debtBeforeUsd.toFixed(2)}`,
    `תשלום שנקלט: $${input.paymentUsd.toFixed(2)}`,
    `עמלה שנוצרה: ${formatSignedUsdDisplay(input.surplusUsd)}`,
    `קשור לקליטה ${input.captureCode}`,
  ].join("\n");
}

export function parsePaymentFeeContextNotes(notes: string | null | undefined): {
  debtBeforeUsd: number | null;
  paidUsd: number | null;
  paymentCapturedUsd: number | null;
  resetUsd: number | null;
  feeUsd: number | null;
} {
  const text = notes ?? "";
  const num = (label: string): number | null => {
    const m = new RegExp(`${label}:\\s*([+-]?\\$?[\\d,]+(?:\\.\\d+)?)`, "i").exec(text);
    if (!m) return null;
    const v = Number(m[1]!.replace(/[$,]/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  return {
    debtBeforeUsd: num("חוב לפני הפעולה"),
    paidUsd: num("שולם"),
    paymentCapturedUsd: num("תשלום שנקלט"),
    resetUsd: num("יתרה שאופסה"),
    feeUsd: num("עמלה שנוצרה"),
  };
}

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
