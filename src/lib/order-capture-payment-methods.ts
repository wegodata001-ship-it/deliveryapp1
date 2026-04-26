import { PaymentMethod } from "@prisma/client";

/** ערכי wire מפורשים — לא תלויים ב-runtime של אובייקט ה-enum (מונע שליחת תווית בעברית כש-value חסר) */
const WIRE = {
  CREDIT: "CREDIT",
  CASH: "CASH",
  BANK_TRANSFER: "BANK_TRANSFER",
  CHECK: "CHECK",
} as const;

/** אמצעי תשלום לפיצול בשורות קליטת הזמנה — value הוא מחרוזת ה-enum לשליחה לשרת */
export const ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS: { label: string; value: PaymentMethod }[] = [
  { label: "אשראי", value: WIRE.CREDIT as PaymentMethod },
  { label: "מזומן", value: WIRE.CASH as PaymentMethod },
  { label: "העברה בנקאית", value: WIRE.BANK_TRANSFER as PaymentMethod },
  { label: "צ׳ק", value: WIRE.CHECK as PaymentMethod },
];

export const ORDER_CAPTURE_SPLIT_PAYMENT_METHOD_SET = new Set<PaymentMethod>(
  ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((o) => o.value),
);

/** ממיר ערך שמגיע מהטופס (enum, עברית מ-label של select, רווחים/Bidi) ל-enum מותר לפיצול */
export function parseSplitPaymentMethodRaw(raw: unknown): PaymentMethod | null {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/[\u200e\u200f\u202a-\u202e\u200b-\u200d\ufeff]/g, "")
    .trim();
  if (!cleaned) return null;
  const up = cleaned.toUpperCase();
  if (ORDER_CAPTURE_SPLIT_PAYMENT_METHOD_SET.has(up as PaymentMethod)) return up as PaymentMethod;
  const byHebrewLabel: Record<string, PaymentMethod> = {
    "אשראי": PaymentMethod.CREDIT,
    "מזומן": PaymentMethod.CASH,
    "העברה בנקאית": PaymentMethod.BANK_TRANSFER,
    "צ׳ק": PaymentMethod.CHECK,
    "צק": PaymentMethod.CHECK,
  };
  return byHebrewLabel[cleaned] ?? null;
}

export function orderCaptureSplitMethodLabel(m: PaymentMethod): string {
  return ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.find((o) => o.value === m)?.label ?? m;
}
