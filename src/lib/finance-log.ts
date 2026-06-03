/** לוג אחיד לביקורת מקור הגדרות כספים — FinancialSettings בלבד */

export const FINANCE_SOURCE_TABLE = "FinancialSettings" as const;

export type FinanceSaveTarget =
  | typeof FINANCE_SOURCE_TABLE
  | "Order"
  | "Payment"
  | "none";

export function logFinanceSourceTable(consumer: string, extra?: Record<string, unknown>): void {
  console.log("[finance] source table", { table: FINANCE_SOURCE_TABLE, consumer, ...extra });
}

export function logFinanceLoadedValues(
  consumer: string,
  values: {
    baseDollarRate: string;
    dollarFee: string;
    finalDollarRate: string;
    defaultCommissionPercent: string;
    id?: string | null;
    ms?: number;
  },
): void {
  console.log("[finance] loaded values", { consumer, table: FINANCE_SOURCE_TABLE, ...values });
}

export function logFinanceSaveTarget(
  consumer: string,
  target: FinanceSaveTarget,
  extra?: Record<string, unknown>,
): void {
  console.log("[finance] save target", { consumer, target, ...extra });
}
