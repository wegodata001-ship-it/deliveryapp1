/**
 * מיפוי הוצאות קופה → ערוץ בקרת קופה (מטבע + אמצעי תשלום).
 */

import type { CashCurrency } from "@/app/admin/cash-control/constants";
import {
  CASH_DAILY_METHODS,
  emptyDailyIntake,
  formatChannelLabel,
  type CashDailyIntakeTotals,
  type CashDailyMethodId,
} from "@/lib/cash-control-daily";
import {
  normalizeCashControlCurrency,
  normalizeExpensePaymentMethod,
  resolveCashControlChannel,
  type CashExpensePaymentMethod,
} from "@/lib/cash-control-channel";

export type { CashExpensePaymentMethod } from "@/lib/cash-control-channel";
export { normalizeExpensePaymentMethod as normalizePaymentMethod } from "@/lib/cash-control-channel";

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
  const norm = normalizeExpensePaymentMethod(method);
  return PAYMENT_METHOD_LABEL[norm];
}

export function allowedCurrenciesForPaymentMethod(method: CashExpensePaymentMethod): CashCurrency[] {
  switch (method) {
    case "CASH":
    case "BANK_TRANSFER":
    case "OTHER":
    case "CREDIT_CARD":
    case "CHECK":
      return ["ILS", "USD"];
    default:
      return ["ILS"];
  }
}

/** מיפוי לערוץ בקרת קופה — מקור אמת יחיד */
export function expenseToDailyMethodId(
  paymentMethod: CashExpensePaymentMethod | string | null | undefined,
  currency: CashCurrency | string,
): CashDailyMethodId {
  return resolveCashControlChannel(paymentMethod, currency);
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
    const currency = normalizeCashControlCurrency(r.currency);
    totals = addExpenseToMethodTotals(totals, r.paymentMethod, currency, amt);
  }
  return totals;
}

export function expensesCurrencyTotals(byMethod: CashDailyExpensesByMethod): { ils: number; usd: number } {
  let ils = 0;
  let usd = 0;
  for (const m of CASH_DAILY_METHODS) {
    const v = byMethod[m.id] ?? 0;
    if (m.currency === "USD") usd = round2(usd + v);
    else ils = round2(ils + v);
  }
  return { ils, usd };
}

export function cashDrawerExpenseTotals(byMethod: CashDailyExpensesByMethod): { ils: number; usd: number } {
  return { ils: round2(byMethod.CASH_ILS), usd: round2(byMethod.CASH_USD) };
}

export function dailyMethodLabel(methodId: CashDailyMethodId): string {
  return formatChannelLabel(methodId);
}

export function channelLabel(methodId: CashDailyMethodId, _currency?: "ILS" | "USD"): string {
  return formatChannelLabel(methodId);
}
