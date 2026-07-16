import type { PaymentAdjustmentReason } from "@prisma/client";
import type { IntakeFeeReasonCode, IntakeMethodCode } from "@/lib/payment-intake-rebuild/types";

export const INTAKE_METHOD_OPTIONS: { code: IntakeMethodCode; labelHe: string; currency: "ILS" | "USD" }[] = [
  { code: "CASH", labelHe: "מזומן", currency: "ILS" },
  { code: "CREDIT", labelHe: "אשראי", currency: "ILS" },
  { code: "BANK_TRANSFER", labelHe: "העברה", currency: "ILS" },
  { code: "CHECK", labelHe: "צ׳ק", currency: "ILS" },
  { code: "USD", labelHe: "דולר", currency: "USD" },
  { code: "BIT", labelHe: "Bit", currency: "ILS" },
  { code: "PAYBOX", labelHe: "PayBox", currency: "ILS" },
  { code: "OTHER", labelHe: "אחר", currency: "ILS" },
];

export const INTAKE_FEE_OPTIONS: {
  code: IntakeFeeReasonCode;
  labelHe: string;
  prismaReason: PaymentAdjustmentReason;
}[] = [
  { code: "BANK_FEE", labelHe: "עמלת בנק", prismaReason: "BANK_FEE" },
  { code: "FX_DIFF", labelHe: "עמלת מט״ח", prismaReason: "FX_DIFF" },
  { code: "CREDIT_FEE", labelHe: "עמלת אשראי", prismaReason: "MANUAL_ADJUST" },
  { code: "TRANSFER_FEE", labelHe: "עמלת העברה", prismaReason: "BANK_FEE" },
  { code: "OTHER", labelHe: "עמלה אחרת", prismaReason: "OTHER" },
];

export function intakeMethodLabel(code: IntakeMethodCode): string {
  return INTAKE_METHOD_OPTIONS.find((o) => o.code === code)?.labelHe ?? code;
}

export function mapFeeReasonToPrisma(code: IntakeFeeReasonCode): PaymentAdjustmentReason {
  return INTAKE_FEE_OPTIONS.find((o) => o.code === code)?.prismaReason ?? "OTHER";
}

/** מיפוי לשדות Payment (usd/ils method strings) */
export function mapIntakeMethodToPaymentFields(method: IntakeMethodCode): {
  paymentMethod: string;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
} {
  switch (method) {
    case "USD":
      return { paymentMethod: "CASH", usdPaymentMethod: "CASH", ilsPaymentMethod: null };
    case "CASH":
      return { paymentMethod: "CASH", usdPaymentMethod: null, ilsPaymentMethod: "CASH" };
    case "CREDIT":
      return { paymentMethod: "CREDIT", usdPaymentMethod: null, ilsPaymentMethod: "CREDIT" };
    case "BANK_TRANSFER":
      return {
        paymentMethod: "BANK_TRANSFER",
        usdPaymentMethod: null,
        ilsPaymentMethod: "BANK_TRANSFER",
      };
    case "CHECK":
      return { paymentMethod: "CHECK", usdPaymentMethod: null, ilsPaymentMethod: "CHECK" };
    case "BIT":
      return { paymentMethod: "OTHER", usdPaymentMethod: null, ilsPaymentMethod: "BIT" };
    case "PAYBOX":
      return { paymentMethod: "OTHER", usdPaymentMethod: null, ilsPaymentMethod: "PAYBOX" };
    case "OTHER":
    default:
      return { paymentMethod: "OTHER", usdPaymentMethod: null, ilsPaymentMethod: "OTHER" };
  }
}
