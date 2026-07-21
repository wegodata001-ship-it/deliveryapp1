/**
 * One-time / ops: rebuild OrderPaymentBreakdown paidAmount + remainingAmount
 * from Ledger + PaymentMethodAllocation via Finance Data Layer Matching Engine.
 *
 * Does NOT change Order totals or Payment amounts.
 */

import {
  applyDualCurrencyMatching,
  methodBalanceFromBreakdownRow,
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  withMethodStatus,
  type EnteredBucketAmount,
  type MethodBalanceRow,
} from "@/lib/finance-data/matching";
import { computeOpenDebtUsd, sumPaymentAmountUsd } from "@/lib/finance-data/ledger";
import { FINANCE_EPS, nearlyEqual, roundMoney2 } from "@/lib/finance-data/types";
import { validateBreakdown } from "@/lib/finance-data/validators";

export type BreakdownSyncOrderInput = {
  orderId: string;
  orderNumber: string | null;
  totalUsd: number;
  exchangeRate: number;
  breakdown: Array<{
    id: string;
    paymentMethod: string;
    amount: number;
    currency: string;
    paidAmount: number;
    remainingAmount: number | null;
  }>;
  payments: Array<{
    id: string;
    amountUsd: number;
    amountIls: number;
    paymentMethod: string | null;
    usdPaymentMethod: string | null;
    ilsPaymentMethod: string | null;
    paymentDate: Date | null;
    createdAt: Date;
    allocations: Array<{
      method: string;
      currency: string;
      sourceAmount: number;
      amountUsd: number;
    }>;
  }>;
};

export type BreakdownSyncResult = {
  orderId: string;
  orderNumber: string | null;
  neededFix: boolean;
  fixed: boolean;
  skippedReason?: string;
  before: { sumPaidUsd: number; sumRemainingUsd: number; openDebtUsd: number; sumPaidIls: number; sumRemainingIls: number };
  after: { sumPaidUsd: number; sumRemainingUsd: number; openDebtUsd: number; sumPaidIls: number; sumRemainingIls: number };
  updates: Array<{ breakdownId: string; paidAmount: number; remainingAmount: number }>;
  validationOk: boolean;
};

function sumByCurrency(
  rows: Array<{ currency: string; paidAmount: number; remainingAmount: number | null; amount: number }>,
) {
  let sumPaidUsd = 0;
  let sumRemUsd = 0;
  let sumPaidIls = 0;
  let sumRemIls = 0;
  for (const r of rows) {
    const cur = r.currency.toUpperCase() === "ILS" ? "ILS" : "USD";
    const paid = roundMoney2(r.paidAmount);
    const rem =
      r.remainingAmount != null
        ? roundMoney2(Math.max(0, r.remainingAmount))
        : roundMoney2(Math.max(0, r.amount - r.paidAmount));
    if (cur === "ILS") {
      sumPaidIls = roundMoney2(sumPaidIls + paid);
      sumRemIls = roundMoney2(sumRemIls + rem);
    } else {
      sumPaidUsd = roundMoney2(sumPaidUsd + paid);
      sumRemUsd = roundMoney2(sumRemUsd + rem);
    }
  }
  return { sumPaidUsd, sumRemUsd, sumPaidIls, sumRemIls };
}

function enteredFromPayment(payment: BreakdownSyncOrderInput["payments"][number]): EnteredBucketAmount[] {
  const byKey = new Map<string, EnteredBucketAmount>();

  const add = (method: string, currency: "USD" | "ILS", entered: number) => {
    if (!(entered > FINANCE_EPS)) return;
    const bucket = paymentMethodBucketKey(method);
    const key = `${currency}:${bucket}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.entered = roundMoney2(prev.entered + entered);
    } else {
      byKey.set(key, {
        bucket,
        label: PAYMENT_BUCKET_LABELS[bucket],
        currency,
        entered: roundMoney2(entered),
      });
    }
  };

  if (payment.allocations.length > 0) {
    for (const a of payment.allocations) {
      const cur = a.currency.toUpperCase() === "ILS" ? "ILS" : "USD";
      const amt = cur === "ILS" ? a.sourceAmount : a.amountUsd;
      add(a.method, cur, amt);
    }
    return [...byKey.values()];
  }

  // Fallback: single-method payment
  const usd = roundMoney2(payment.amountUsd);
  const ils = roundMoney2(payment.amountIls);
  if (usd > FINANCE_EPS) {
    add(payment.usdPaymentMethod || payment.paymentMethod || "OTHER", "USD", usd);
  }
  if (ils > FINANCE_EPS) {
    add(payment.ilsPaymentMethod || payment.paymentMethod || "OTHER", "ILS", ils);
  }
  return [...byKey.values()];
}

/**
 * After matching replay, force Σ remaining(USD) === openDebtUsd.
 * Prefer increasing paid (up to planned) before zeroing leftover remaining.
 */
function reconcileUsdToOpenDebt(
  balances: MethodBalanceRow[],
  openDebtUsd: number,
): MethodBalanceRow[] {
  const target = roundMoney2(Math.max(0, openDebtUsd));
  let rows = balances.map((b) => withMethodStatus({ ...b }));

  const sumRem = () =>
    roundMoney2(
      rows.filter((r) => r.currency === "USD").reduce((s, r) => s + r.remaining, 0),
    );

  let rem = sumRem();
  // Too much remaining → apply as paid against capacity
  if (rem > target + FINANCE_EPS) {
    let excess = roundMoney2(rem - target);
    for (const row of rows) {
      if (excess <= FINANCE_EPS) break;
      if (row.currency !== "USD" || row.remaining <= FINANCE_EPS) continue;
      const take = roundMoney2(Math.min(excess, row.remaining));
      row.paid = roundMoney2(row.paid + take);
      row.remaining = roundMoney2(Math.max(0, row.remaining - take));
      excess = roundMoney2(excess - take);
    }
    rows = rows.map((b) => withMethodStatus(b));
    rem = sumRem();
  }

  // Still too much (paid hit planned) → zero remaining without changing planned
  if (rem > target + FINANCE_EPS) {
    let excess = roundMoney2(rem - target);
    for (const row of rows) {
      if (excess <= FINANCE_EPS) break;
      if (row.currency !== "USD" || row.remaining <= FINANCE_EPS) continue;
      const take = roundMoney2(Math.min(excess, row.remaining));
      row.remaining = roundMoney2(Math.max(0, row.remaining - take));
      excess = roundMoney2(excess - take);
    }
    rows = rows.map((b) => withMethodStatus(b));
  }

  // Too little remaining → restore remaining from paid (rare)
  rem = sumRem();
  if (rem + FINANCE_EPS < target) {
    let need = roundMoney2(target - rem);
    for (const row of rows) {
      if (need <= FINANCE_EPS) break;
      if (row.currency !== "USD" || row.paid <= FINANCE_EPS) continue;
      const give = roundMoney2(Math.min(need, row.paid));
      row.paid = roundMoney2(Math.max(0, row.paid - give));
      row.remaining = roundMoney2(row.remaining + give);
      need = roundMoney2(need - give);
    }
    rows = rows.map((b) => withMethodStatus(b));
  }

  return rows;
}

export function orderNeedsBreakdownSync(input: BreakdownSyncOrderInput): boolean {
  if (input.breakdown.length === 0) return false;
  const paidUsd = sumPaymentAmountUsd(input.payments);
  const snap = computeOpenDebtUsd({
    orderId: input.orderId,
    totalUsd: input.totalUsd,
    paidUsd,
  });
  const openDebtUsd = roundMoney2(Math.max(0, snap.openDebtUsd));
  const sums = sumByCurrency(input.breakdown);

  if (!nearlyEqual(sums.sumRemUsd, openDebtUsd, FINANCE_EPS)) return true;
  if (!nearlyEqual(sums.sumPaidUsd, paidUsd, FINANCE_EPS)) {
    // Ledger paid in USD vs Σ paidAmount on USD breakdown rows
    return true;
  }
  return false;
}

export function rebuildBreakdownSnapshots(input: BreakdownSyncOrderInput): BreakdownSyncResult {
  const paidUsd = sumPaymentAmountUsd(input.payments);
  const snap = computeOpenDebtUsd({
    orderId: input.orderId,
    totalUsd: input.totalUsd,
    paidUsd,
  });
  const openDebtUsd = roundMoney2(Math.max(0, snap.openDebtUsd));
  const before = sumByCurrency(input.breakdown);
  const beforeView = {
    sumPaidUsd: before.sumPaidUsd,
    sumRemainingUsd: before.sumRemUsd,
    openDebtUsd,
    sumPaidIls: before.sumPaidIls,
    sumRemainingIls: before.sumRemIls,
  };

  if (input.breakdown.length === 0) {
    return {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      neededFix: false,
      fixed: false,
      skippedReason: "no-breakdown",
      before: beforeView,
      after: beforeView,
      updates: [],
      validationOk: true,
    };
  }

  const neededFix = orderNeedsBreakdownSync(input);
  if (!neededFix) {
    const rows = input.breakdown.map((b) => ({
      id: b.id,
      orderId: input.orderId,
      paymentMethod: b.paymentMethod,
      amount: b.amount,
      currency: (b.currency.toUpperCase() === "ILS" ? "ILS" : "USD") as "USD" | "ILS",
      paidAmount: b.paidAmount,
      remainingAmount: b.remainingAmount,
    }));
    const v = validateBreakdown({ orderId: input.orderId, openDebtUsd, rows });
    return {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      neededFix: false,
      fixed: false,
      before: beforeView,
      after: beforeView,
      updates: [],
      validationOk: v.ok,
    };
  }

  // Start clean: paid=0, remaining=planned
  let balances: MethodBalanceRow[] = input.breakdown.map((b) =>
    methodBalanceFromBreakdownRow({
      breakdownId: b.id,
      orderId: input.orderId,
      paymentMethod: b.paymentMethod,
      amount: b.amount,
      currency: b.currency,
      paidAmount: 0,
      remainingAmount: roundMoney2(Math.max(0, b.amount)),
    }),
  );

  const paymentsChrono = [...input.payments].sort((a, b) => {
    const ad = (a.paymentDate ?? a.createdAt).getTime();
    const bd = (b.paymentDate ?? b.createdAt).getTime();
    if (ad !== bd) return ad - bd;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const rate = input.exchangeRate > 0 ? input.exchangeRate : 0;
  const rateByOrderId = new Map([[input.orderId, rate]]);

  for (const payment of paymentsChrono) {
    const entered = enteredFromPayment(payment);
    if (entered.length === 0) continue;
    const dual = applyDualCurrencyMatching({
      balances,
      enteredByBucket: entered,
      orderIdsOldestFirst: [input.orderId],
      rateByOrderId,
    });
    balances = dual.balances;
  }

  balances = reconcileUsdToOpenDebt(balances, openDebtUsd);

  // ILS: keep matching result; openDebtIls = Σ remaining ILS after rebuild (native)
  const updates = input.breakdown.map((b) => {
    const bal =
      balances.find((x) => x.breakdownId === b.id) ??
      balances.find(
        (x) =>
          x.orderId === input.orderId &&
          x.method === b.paymentMethod &&
          x.currency === (b.currency.toUpperCase() === "ILS" ? "ILS" : "USD"),
      );
    const paidAmount = roundMoney2(bal?.paid ?? 0);
    const remainingAmount = roundMoney2(Math.max(0, bal?.remaining ?? 0));
    return { breakdownId: b.id, paidAmount, remainingAmount };
  });

  const afterRows = input.breakdown.map((b) => {
    const u = updates.find((x) => x.breakdownId === b.id)!;
    return {
      id: b.id,
      orderId: input.orderId,
      paymentMethod: b.paymentMethod,
      amount: b.amount,
      currency: (b.currency.toUpperCase() === "ILS" ? "ILS" : "USD") as "USD" | "ILS",
      paidAmount: u.paidAmount,
      remainingAmount: u.remainingAmount,
    };
  });
  const afterSums = sumByCurrency(afterRows);
  const openDebtIls = afterSums.sumRemIls; // ILS has no separate order ledger — consistency = matching result
  const validation = validateBreakdown({
    orderId: input.orderId,
    openDebtUsd,
    openDebtIls,
    rows: afterRows,
  });

  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    neededFix: true,
    fixed: true,
    before: beforeView,
    after: {
      sumPaidUsd: afterSums.sumPaidUsd,
      sumRemainingUsd: afterSums.sumRemUsd,
      openDebtUsd,
      sumPaidIls: afterSums.sumPaidIls,
      sumRemainingIls: afterSums.sumRemIls,
    },
    updates,
    validationOk: validation.ok,
  };
}
