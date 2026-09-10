/**
 * SSOT — סוגי הוצאות קופה (CashExpenseType).
 * CashExpense.reason נשאר מחרוזת (קוד); התווית מגיעה מהטבלה.
 * הוצאות היסטוריות עם קוד ישן ממשיכות לעבוד דרך fallback.
 */

import { CASH_EXPENSE_REASONS, EMPLOYEE_CASH_EXPENSE_REASONS } from "@/app/admin/cash-control/constants";

export const CASH_EXPENSE_NEW_TYPE_VALUE = "__new_cash_expense_type__";

export const CASH_EXPENSE_TYPE_SEED: ReadonlyArray<{
  code: string;
  label: string;
  sortOrder: number;
}> = CASH_EXPENSE_REASONS.map((r, i) => ({
  code: r.value,
  label: r.label,
  sortOrder: (i + 1) * 10,
}));

const SEED_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  CASH_EXPENSE_TYPE_SEED.map((t) => [t.code, t.label]),
);

export const EMPLOYEE_CASH_EXPENSE_TYPE_CODES = new Set<string>(
  EMPLOYEE_CASH_EXPENSE_REASONS.map((r) => r.value),
);

export type CashExpenseTypeDto = {
  code: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
};

export function normalizeCashExpenseTypeLabel(raw: string): string {
  return raw.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
}

export function cashExpenseTypeLabelKey(raw: string): string {
  return normalizeCashExpenseTypeLabel(raw).toLocaleLowerCase("he");
}

export function fallbackCashExpenseTypeLabel(code: string): string {
  return SEED_LABEL_BY_CODE[code] ?? code;
}

export function resolveCashExpenseTypeLabel(
  code: string | null | undefined,
  labelMap?: Map<string, string> | null,
): string {
  const c = (code ?? "").trim();
  if (!c) return "—";
  return labelMap?.get(c) ?? fallbackCashExpenseTypeLabel(c);
}

export function generateCustomCashExpenseTypeCode(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CE_${Date.now().toString(36).toUpperCase()}_${rand}`;
}

export function findCashExpenseTypeByLabel(
  types: ReadonlyArray<{ code: string; label: string }>,
  rawLabel: string,
): { code: string; label: string } | null {
  const key = cashExpenseTypeLabelKey(rawLabel);
  if (!key) return null;
  return types.find((t) => cashExpenseTypeLabelKey(t.label) === key) ?? null;
}

export function validateNewCashExpenseTypeLabel(raw: string): string | null {
  const label = normalizeCashExpenseTypeLabel(raw);
  if (!label) return "יש להזין שם לסוג ההוצאה";
  if (label.length > 80) return "שם סוג ההוצאה ארוך מדי";
  return null;
}
