/**
 * מיפוי מרכזי — אמצעי תשלום + מטבע → ערוץ בקרת קופה.
 * מקור אמת יחיד לקליטות, הוצאות, ספירה וחריגות.
 */

import type { PaymentBucketKey } from "@/lib/payment-breakdown-shared";

export type CashControlCurrency = "USD" | "ILS";

export type CashExpensePaymentMethod =
  | "CASH"
  | "CREDIT_CARD"
  | "CHECK"
  | "BANK_TRANSFER"
  | "OTHER";

export type CashControlChannel =
  | "CASH_USD"
  | "CASH_ILS"
  | "BANK_TRANSFER_USD"
  | "BANK_TRANSFER_ILS"
  | "CREDIT_CARD_USD"
  | "CREDIT_CARD_ILS"
  | "CHECK_USD"
  | "CHECK_ILS"
  | "OTHER_USD"
  | "OTHER_ILS";

/** תאימות — שם היסטורי בקוד */
export type CashDailyMethodId = CashControlChannel;

export type CashControlChannelMeta = {
  id: CashControlChannel;
  label: string;
  currency: CashControlCurrency;
};

export const CASH_CONTROL_CHANNELS: CashControlChannelMeta[] = [
  { id: "CASH_ILS", label: "מזומן ₪", currency: "ILS" },
  { id: "CASH_USD", label: "מזומן $", currency: "USD" },
  { id: "BANK_TRANSFER_ILS", label: "העברה ₪", currency: "ILS" },
  { id: "BANK_TRANSFER_USD", label: "העברה $", currency: "USD" },
  { id: "CREDIT_CARD_ILS", label: "אשראי ₪", currency: "ILS" },
  { id: "CREDIT_CARD_USD", label: "אשראי $", currency: "USD" },
  { id: "CHECK_ILS", label: "צ'קים ₪", currency: "ILS" },
  { id: "CHECK_USD", label: "צ'קים $", currency: "USD" },
  { id: "OTHER_ILS", label: "אחר ₪", currency: "ILS" },
  { id: "OTHER_USD", label: "אחר $", currency: "USD" },
];

export const CASH_DAILY_METHODS = CASH_CONTROL_CHANNELS;

export type CashDailyDrawerDbField =
  | "cashIls"
  | "cashUsd"
  | "transferIls"
  | "transferUsd"
  | "creditIls"
  | "creditUsd"
  | "checksIls"
  | "checksUsd"
  | "otherIls"
  | "otherUsd";

export const CHANNEL_DRAWER_FIELD: Record<CashControlChannel, CashDailyDrawerDbField> = {
  CASH_ILS: "cashIls",
  CASH_USD: "cashUsd",
  BANK_TRANSFER_ILS: "transferIls",
  BANK_TRANSFER_USD: "transferUsd",
  CREDIT_CARD_ILS: "creditIls",
  CREDIT_CARD_USD: "creditUsd",
  CHECK_ILS: "checksIls",
  CHECK_USD: "checksUsd",
  OTHER_ILS: "otherIls",
  OTHER_USD: "otherUsd",
};

export function normalizeExpensePaymentMethod(raw: string | null | undefined): CashExpensePaymentMethod {
  const v = (raw ?? "CASH").trim().toUpperCase();
  if (v === "CASH" || v === "מזומן") return "CASH";
  if (v === "CREDIT_CARD" || v === "CREDIT" || v === "CARD" || v === "אשראי") return "CREDIT_CARD";
  if (v === "CHECK" || v === "CHEQUE" || v === "צ'ק" || v === "צק") return "CHECK";
  if (
    v === "BANK_TRANSFER" ||
    v === "TRANSFER" ||
    v === "WIRE" ||
    v === "BANK" ||
    v === "BANK_TRANSFER_DONE" ||
    v === "העברה"
  ) {
    return "BANK_TRANSFER";
  }
  if (v === "OTHER" || v === "אחר") return "OTHER";
  return "CASH";
}

export function normalizeCashControlCurrency(raw: string | null | undefined): CashControlCurrency {
  const v = (raw ?? "ILS").trim().toUpperCase();
  if (v === "USD" || v === "$" || v === "DOLLAR" || v === "DOL") return "USD";
  return "ILS";
}

/** מיפוי הוצאה / תשלום → ערוץ בקרת קופה */
export function resolveCashControlChannel(
  paymentMethod: CashExpensePaymentMethod | string | null | undefined,
  currency: CashControlCurrency | string | null | undefined,
): CashControlChannel {
  const pm = normalizeExpensePaymentMethod(paymentMethod);
  const cur = normalizeCashControlCurrency(currency);

  if (pm === "CASH") return cur === "USD" ? "CASH_USD" : "CASH_ILS";
  if (pm === "BANK_TRANSFER") return cur === "USD" ? "BANK_TRANSFER_USD" : "BANK_TRANSFER_ILS";
  if (pm === "CREDIT_CARD") return cur === "USD" ? "CREDIT_CARD_USD" : "CREDIT_CARD_ILS";
  if (pm === "CHECK") return cur === "USD" ? "CHECK_USD" : "CHECK_ILS";
  return cur === "USD" ? "OTHER_USD" : "OTHER_ILS";
}

/** מיפוי bucket מקליטת תשלום → ערוץ */
export function resolveChannelFromPaymentBucket(
  bucket: PaymentBucketKey,
  side: CashControlCurrency,
): CashControlChannel | null {
  if (bucket === "CASH") return side === "USD" ? "CASH_USD" : "CASH_ILS";
  if (bucket === "BANK_TRANSFER") return side === "USD" ? "BANK_TRANSFER_USD" : "BANK_TRANSFER_ILS";
  if (bucket === "CREDIT") return side === "USD" ? "CREDIT_CARD_USD" : "CREDIT_CARD_ILS";
  if (bucket === "CHECK") return side === "USD" ? "CHECK_USD" : "CHECK_ILS";
  if (bucket === "OTHER") return side === "USD" ? "OTHER_USD" : "OTHER_ILS";
  return null;
}

export function channelMeta(channel: CashControlChannel): CashControlChannelMeta {
  return CASH_CONTROL_CHANNELS.find((c) => c.id === channel) ?? CASH_CONTROL_CHANNELS[0]!;
}

export function channelCurrency(channel: CashControlChannel): CashControlCurrency {
  return channelMeta(channel).currency;
}

export function formatChannelLabel(channel: CashControlChannel): string {
  return channelMeta(channel).label;
}

export function emptyChannelTotals(): Record<CashControlChannel, number> {
  return Object.fromEntries(CASH_CONTROL_CHANNELS.map((c) => [c.id, 0])) as Record<
    CashControlChannel,
    number
  >;
}

export function allCashControlChannels(): CashControlChannel[] {
  return CASH_CONTROL_CHANNELS.map((c) => c.id);
}

export function channelGroupClass(channel: CashControlChannel): string {
  if (channel.startsWith("CASH_")) return channel.endsWith("_USD") ? "cc-col--usd" : "cc-col--ils";
  if (channel.startsWith("BANK_TRANSFER")) return "cc-col--transfer";
  if (channel.startsWith("CREDIT_CARD")) return "cc-col--credit";
  if (channel.startsWith("CHECK")) return "cc-col--check";
  return "cc-col--other";
}

export function channelColLabels(): Record<CashControlChannel, string> {
  return Object.fromEntries(CASH_CONTROL_CHANNELS.map((c) => [c.id, c.label])) as Record<
    CashControlChannel,
    string
  >;
}
