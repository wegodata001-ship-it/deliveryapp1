/**
 * מיפוי הוצאות קופה → עמודת בקרת קופה (מטבע + אמצעי תשלום).
 */

import type { CashCurrency } from "@/app/admin/cash-control/constants";
import {
  CASH_DAILY_METHODS,
  emptyDailyIntake,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";

export type CashExpensePaymentMethod = "CASH" | "CREDIT_CARD" | "CHECK" | "BANK_TRANSFER" | "OTHER";

export const CASH_EXPENSE_PAYMENT_METHODS: { value: CashExpensePaymentMethod; label: string }[] = [
  { value: "CASH", label: "מזומן" },
  { value: "CREDIT_CARD", label: "אשראי" },
  { value: "CHECK", label: "צ'ק" },
  { value: "BANK_TRANSFER", label: "העברה בנקאית" },
  { value: "OTHER", label: "אחר" },
];

const PAYMENT_METHOD_LABEL: Record<CashExpensePaymentMethod, string> = Object.fromEntries(
  CASH_EXPENSE_PAYMENT_METHODS.map((m) => [m.value, m.label]),
) as Record<CashExpensePaymentMethod, string>;

export function paymentMethodLabel(method: CashExpensePaymentMethod | string | null | undefined): string {
  const norm = normalizePaymentMethod(method);
  return PAYMENT_METHOD_LABEL[norm];
}

export function normalizePaymentMethod(raw: string | null | undefined): CashExpensePaymentMethod {
  const v = (raw ?? "CASH").trim().toUpperCase();
  if (v === "CASH" || v === "מזומן") return "CASH";
  if (v === "CREDIT_CARD" || v === "CREDIT" || v === "אשראי") return "CREDIT_CARD";
  if (v === "CHECK" || v === "צ'ק" || v === "צק") return "CHECK";
  if (v === "BANK_TRANSFER" || v === "TRANSFER" || v === "העברה") return "BANK_TRANSFER";
  if (v === "OTHER" || v === "אחר") return "OTHER";
  return "CASH";
}

/** מטבעות מותרים לפי אמצעי תשלום */
export function allowedCurrenciesForPaymentMethod(method: CashExpensePaymentMethod): CashCurrency[] {
  switch (method) {
    case "CASH":
    case "BANK_TRANSFER":
    case "OTHER":
      return ["ILS", "USD"];
    case "CREDIT_CARD":
    case "CHECK":
      return ["ILS", "USD"];
    default:
      return ["ILS"];
  }
}

/**
 * מיפוי לעמודת בקרת קופה.
 * הוצאות ללא שדה (ישנות) → מזומן לפי מטבע.
 */
export function expenseToDailyMethodId(
  paymentMethod: CashExpensePaymentMethod | string | null | undefined,
  currency: CashCurrency | string,
): CashDailyMethodId {
  const pm = normalizePaymentMethod(paymentMethod);
  const cur = currency === "USD" ? "USD" : "ILS";

  if (pm === "CASH") return cur === "USD" ? "CASH_USD" : "CASH_ILS";
  if (pm === "CREDIT_CARD") return cur === "USD" ? "OTHER" : "CREDIT";
  if (pm === "CHECK") return cur === "USD" ? "OTHER" : "CHECK";
  if (pm === "BANK_TRANSFER") return cur === "USD" ? "OTHER" : "BANK_TRANSFER";
  return "OTHER";
}

export type CashDailyExpensesByMethod = CashDailyIntakeTotals;

export function emptyExpensesByMethod(): CashDailyExpensesByMethod {
  return emptyDailyIntake();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addExpenseToMethodTotals(
  totals: CashDailyExpensesByMethod,
  paymentMethod: CashExpensePaymentMethod | string | null | undefined,
  currency: CashCurrency | string,
  amount: number,
): CashDailyExpensesByMethod {
  const col = expenseToDailyMethodId(paymentMethod, currency);
  return { ...totals, [col]: round2((totals[col] ?? 0) + amount) };
}

export function aggregateExpensesByMethod(
  rows: Array<{
    currency: string;
    amount: number | { toString(): string } | null;
    paymentMethod?: string | null;
  }>,
): CashDailyExpensesByMethod {
  let totals = emptyExpensesByMethod();
  for (const r of rows) {
    const amt = Number(r.amount?.toString() ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const currency = r.currency === "USD" ? "USD" : "ILS";
    totals = addExpenseToMethodTotals(totals, r.paymentMethod, currency, amt);
  }
  return totals;
}

/** סיכום לתצוגה לפי מטבע (כל האמצעים) */
export function expensesCurrencyTotals(byMethod: CashDailyExpensesByMethod): { ils: number; usd: number } {
  const ils = round2(
    byMethod.CASH_ILS + byMethod.CREDIT + byMethod.CHECK + byMethod.BANK_TRANSFER + byMethod.OTHER,
  );
  return { ils, usd: round2(byMethod.CASH_USD) };
}

/** הוצאות מזומן בלבד — לחישוב יתרה פיזית בקופה */
export function cashDrawerExpenseTotals(byMethod: CashDailyExpensesByMethod): { ils: number; usd: number } {
  return { ils: round2(byMethod.CASH_ILS), usd: round2(byMethod.CASH_USD) };
}

export function dailyMethodLabel(methodId: CashDailyMethodId): string {
  return CASH_DAILY_METHODS.find((m) => m.id === methodId)?.label ?? methodId;
}

export function channelLabel(methodId: CashDailyMethodId, currency: "ILS" | "USD"): string {
  return `${dailyMethodLabel(methodId)} ${currency === "USD" ? "$" : "₪"}`;
}
