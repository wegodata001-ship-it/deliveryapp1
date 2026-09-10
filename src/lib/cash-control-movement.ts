/**
 * SSOT — הוצאת קופה לפי סכום חתום.
 *
 * expectedCash = cashReceived − SUM(CashExpense.amount)
 *
 * amount > 0 → הוצאה → מוריד מהצפוי
 * amount < 0 → תיקון/החזרה → מוסיף לצפוי
 *
 * CashExpense.direction קיים ב-DB ל-compatibility בלבד.
 * אין להשתמש בו בחישוב, ואין לעשות Math.abs על הסכום.
 */

export const CASH_MOVEMENT_DIRECTIONS = ["EXPENSE", "INCOME"] as const;
export type CashMovementDirection = (typeof CASH_MOVEMENT_DIRECTIONS)[number];

export type NormalizedCashMovement = {
  /** נשמר ל-DTO בלבד — לא משפיע על החישוב */
  direction: CashMovementDirection | null;
  kind: "signed";
  /** הסכום כפי שנשמר, כולל סימן */
  amount: number;
  /** השפעה על הקופה הצפויה: −amount */
  netEffect: number;
  /** מונח לנוסחה expected = received − expenseTerm. שווה ל-amount החתום. */
  expenseTerm: number;
};

function rawToString(raw: number | string | { toString(): string } | null | undefined): string {
  if (raw == null) return "";
  return typeof raw === "number" ? String(raw) : String(raw).replace(",", ".").trim();
}

export function parseSignedCashExpenseAmount(
  raw: number | string | { toString(): string } | null | undefined,
): number | null {
  const s = rawToString(raw);
  if (s === "" || s === "-" || s === "." || s === "-.") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const CASH_EXPENSE_AMOUNT_ERROR = "יש להזין סכום שונה מאפס";
export const CASH_EXPENSE_AMOUNT_INVALID_ERROR = "יש להזין סכום תקין";

export type PersistedCashMovement = {
  amount: number;
  direction: null;
};

export function resolveCreateCashMovement(input: {
  amount?: number | string | { toString(): string } | null;
  direction?: string | null;
}): { ok: true } & PersistedCashMovement | { ok: false; error: string } {
  const amount = parseSignedCashExpenseAmount(input.amount);
  if (amount === null) return { ok: false, error: CASH_EXPENSE_AMOUNT_INVALID_ERROR };
  if (amount === 0) return { ok: false, error: CASH_EXPENSE_AMOUNT_ERROR };
  return { ok: true, amount, direction: null };
}

export function resolveUpdateDirectedCashMovement(input: {
  amount?: number | string | { toString(): string } | null;
  direction?: string | null;
  existingDirection?: CashMovementDirection | null;
}): { ok: true } & PersistedCashMovement | { ok: false; error: string } {
  return resolveCreateCashMovement(input);
}

export function parseCashMovementDirection(
  raw: string | null | undefined,
): CashMovementDirection | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "INCOME" || v === "INFLOW") return "INCOME";
  if (v === "EXPENSE" || v === "OUTFLOW") return "EXPENSE";
  return null;
}

export function cashMovementKindLabel(_direction: string | null | undefined): string | null {
  return null;
}

export function normalizeCashControlMovement(record: {
  amount?: number | string | { toString(): string } | null;
  direction?: string | null;
}): NormalizedCashMovement {
  const amount = parseSignedCashExpenseAmount(record.amount) ?? 0;
  return {
    direction: parseCashMovementDirection(record.direction),
    kind: "signed",
    amount,
    netEffect: -amount,
    expenseTerm: amount,
  };
}

export function cashMovementNetEffect(records: ReadonlyArray<{
  amount?: number | string | { toString(): string } | null;
  direction?: string | null;
}>): number {
  let sum = 0;
  for (const r of records) {
    sum = Math.round((sum + normalizeCashControlMovement(r).netEffect) * 100) / 100;
  }
  return sum;
}

export function cashMovementExpenseTerm(records: ReadonlyArray<{
  amount?: number | string | { toString(): string } | null;
  direction?: string | null;
}>): number {
  const term = Math.round(-cashMovementNetEffect(records) * 100) / 100;
  return term === 0 ? 0 : term;
}
