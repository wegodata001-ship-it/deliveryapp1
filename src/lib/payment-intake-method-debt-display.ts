/**
 * PMC / intake display — debt-closing paid vs breakdown paid (may include commission drift).
 * Display-only; does not mutate DB.
 */

import { roundMoney2 } from "@/lib/payment-intake";

const EPS = 0.005;

export type MethodDebtDisplayLine = {
  plannedUsd: number;
  paidBreakdownUsd: number;
  currency: "USD" | "ILS";
  /** Planned in row native currency — for ILS rows */
  plannedNative: number;
};

/**
 * Split order-level debt-paid (STANDARD allocations / ledger) across method lines by planned USD weight.
 */
export function distributeOrderDebtPaidToMethods(
  orderDebtPaidUsd: number,
  lines: MethodDebtDisplayLine[],
): number[] {
  const target = roundMoney2(Math.max(0, orderDebtPaidUsd));
  if (lines.length === 0) return [];
  const weights = lines.map((l) => Math.max(0, l.plannedUsd));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= EPS || target <= EPS) return lines.map(() => 0);

  let allocated = 0;
  const sharesUsd: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1) {
      sharesUsd.push(roundMoney2(Math.max(0, target - allocated)));
      break;
    }
    const share = roundMoney2(target * (weights[i]! / weightSum));
    allocated = roundMoney2(allocated + share);
    sharesUsd.push(share);
  }

  return lines.map((line, i) => {
    const shareUsd = sharesUsd[i] ?? 0;
    if (line.currency === "ILS" && line.plannedNative > EPS && line.plannedUsd > EPS) {
      return roundMoney2(shareUsd * (line.plannedNative / line.plannedUsd));
    }
    return shareUsd;
  });
}

export function orderBreakdownPaidDriftUsd(
  orderDebtPaidUsd: number,
  breakdownPaidUsdSum: number,
): number {
  return roundMoney2(Math.max(0, breakdownPaidUsdSum - Math.max(0, orderDebtPaidUsd)));
}

export function sumUniqueOrderBreakdownCommissionDrift(
  rows: ReadonlyArray<{
    orderId: string;
    paidBreakdownUsd: number;
    orderDebtPaidUsd: number;
  }>,
): number {
  const byOrder = new Map<string, { breakdown: number; debt: number }>();
  for (const r of rows) {
    if (!r.orderId) continue;
    const prev = byOrder.get(r.orderId) ?? { breakdown: 0, debt: r.orderDebtPaidUsd };
    prev.breakdown = roundMoney2(prev.breakdown + r.paidBreakdownUsd);
    prev.debt = r.orderDebtPaidUsd;
    byOrder.set(r.orderId, prev);
  }
  let total = 0;
  for (const { breakdown, debt } of byOrder.values()) {
    total += orderBreakdownPaidDriftUsd(debt, breakdown);
  }
  return roundMoney2(total);
}
