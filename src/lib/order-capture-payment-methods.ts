import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";

/** ערכי wire מפורשים — לא תלויים ב-runtime של אובייקט ה-enum (מונע שליחת תווית בעברית כש-value חסר) */
const WIRE = {
  CREDIT: "CREDIT",
  CASH: "CASH",
  BANK_TRANSFER: "BANK_TRANSFER",
  CHECK: "CHECK",
} as const;

/** @deprecated — ב-client השתמשו ב-usePaymentMethodCatalog().options */
export const ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS: { label: string; value: string }[] = [
  { label: "אשראי", value: WIRE.CREDIT },
  { label: "מזומן", value: WIRE.CASH },
  { label: "העברה בנקאית", value: WIRE.BANK_TRANSFER },
  { label: "צ׳ק", value: WIRE.CHECK },
];

export const ORDER_CAPTURE_SPLIT_PAYMENT_METHOD_SET = new Set<string>(
  ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((o) => o.value),
);

/** ממיר ערך שמגיע מהטופס (enum, עברית מ-label של select, רווחים/Bidi) ל-enum מותר לפיצול */
export function parseSplitPaymentMethodRaw(raw: unknown): string | null {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/[\u200e\u200f\u202a-\u202e\u200b-\u200d\ufeff]/g, "")
    .trim();
  if (!cleaned) return null;
  const up = normalizePaymentMethodId(cleaned.toUpperCase());
  if (ORDER_CAPTURE_SPLIT_PAYMENT_METHOD_SET.has(up)) return up;
  const normalized = normalizePaymentMethodId(cleaned);
  if (ORDER_CAPTURE_SPLIT_PAYMENT_METHOD_SET.has(normalized)) return normalized;
  if (normalized.startsWith("pm_") || /^[A-Z0-9_]+$/.test(normalized)) return normalized;
  const byHebrewLabel: Record<string, string> = {
    "אשראי": WIRE.CREDIT,
    "מזומן": WIRE.CASH,
    "העברה בנקאית": WIRE.BANK_TRANSFER,
    "צ׳ק": WIRE.CHECK,
    "צק": WIRE.CHECK,
  };
  return byHebrewLabel[cleaned] ?? null;
}

export function orderCaptureSplitMethodLabel(m: string, labelMap?: Record<string, string>): string {
  if (labelMap?.[m]) return labelMap[m];
  return ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.find((o) => o.value === m)?.label ?? m;
}
