/**
 * Money helpers for the Finance Data Layer.
 * Independent of legacy payment-intake helpers — same rounding contract.
 */

export const FINANCE_EPS = 0.02;

export type MoneyCurrency = "USD" | "ILS";

export function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Prisma Decimal | number | null → number */
export function toMoney(value: { toNumber(): number } | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = value.toNumber();
  return Number.isFinite(n) ? n : 0;
}

export function nearlyEqual(a: number, b: number, eps: number = FINANCE_EPS): boolean {
  return Math.abs(roundMoney2(a) - roundMoney2(b)) <= eps;
}
