/**
 * Matching Engine — owned entirely by Finance Data Layer.
 *
 * Currency isolation:
 *   USD engine ↔ USD methods/payments only
 *   ILS engine ↔ ILS methods/payments only
 * No cross-currency match, debt transfer, remaining, surplus, or credit.
 *
 * No imports from:
 *   payment-method-matching-engine
 *   cash-control-calculation
 *   payment-breakdown-shared
 *   legacy payment services
 */

import {
  PAYMENT_BUCKET_LABELS,
  normalizeMatchingCurrency,
  paymentMethodBucketKey,
  type MatchingCurrency,
  type PaymentBucketKey,
} from "./payment-buckets";
import { FINANCE_EPS, roundMoney2 } from "@/lib/finance-data/types/money";

export const MATCHING_EPS = FINANCE_EPS;

export type MethodBalanceStatus = "paid" | "partial" | "open";

export type MethodBalanceRow = {
  breakdownId?: string;
  orderId: string;
  method: string;
  bucket: PaymentBucketKey;
  label: string;
  currency: MatchingCurrency;
  planned: number;
  paid: number;
  remaining: number;
  status: MethodBalanceStatus;
};

export type EnteredBucketAmount = {
  bucket: PaymentBucketKey;
  label: string;
  currency: MatchingCurrency;
  entered: number;
};

export type DebtTransferInput = {
  fromBucket: PaymentBucketKey;
  toBucket: PaymentBucketKey;
  amount: number;
  currency: MatchingCurrency;
  orderId?: string;
};

export type MatchingEngineInput = {
  balances: MethodBalanceRow[];
  enteredByBucket: EnteredBucketAmount[];
  orderIdsOldestFirst: string[];
  debtTransfers?: DebtTransferInput[] | null;
  currency?: MatchingCurrency;
  eps?: number;
};

export type MethodApplyLine = {
  orderId: string;
  bucket: PaymentBucketKey;
  method: string;
  currency: MatchingCurrency;
  amount: number;
};

export type MatchingEngineResult = {
  balances: MethodBalanceRow[];
  appliedLines: MethodApplyLine[];
  amountByOrderId: Map<string, number>;
  surplus: number;
  surplusCurrency: MatchingCurrency;
  transfersApplied: DebtTransferInput[];
};

export type DualCurrencyMatchingResult = {
  usd: MatchingEngineResult;
  ils: MatchingEngineResult;
  balances: MethodBalanceRow[];
  appliedLines: MethodApplyLine[];
  transfersApplied: DebtTransferInput[];
  surplusUsd: number;
  surplusIls: number;
  /** Ledger USD allocation: USD applied + ILS applied converted by order rate */
  amountUsdByOrderId: Map<string, number>;
};

export function deriveMethodStatus(paid: number, remaining: number): MethodBalanceStatus {
  if (remaining <= MATCHING_EPS) return "paid";
  if (paid > MATCHING_EPS) return "partial";
  return "open";
}

export function withMethodStatus(row: MethodBalanceRow): MethodBalanceRow {
  return {
    ...row,
    paid: roundMoney2(row.paid),
    remaining: roundMoney2(Math.max(0, row.remaining)),
    planned: roundMoney2(row.planned),
    status: deriveMethodStatus(row.paid, row.remaining),
  };
}

/** @deprecated use normalizeMatchingCurrency — kept for call-site clarity */
export function normalizeBreakdownCurrency(raw: string | null | undefined): MatchingCurrency {
  return normalizeMatchingCurrency(raw);
}

/**
 * Debt transfer — same currency only.
 * Cross-currency transfers are ignored (not applied).
 */
export function applyDebtTransfersToBalances(
  balances: MethodBalanceRow[],
  transfers: DebtTransferInput[],
  orderIdsOldestFirst: string[],
  eps = MATCHING_EPS,
): { balances: MethodBalanceRow[]; transfersApplied: DebtTransferInput[] } {
  const rows = balances.map((b) => ({ ...b }));
  const applied: DebtTransferInput[] = [];

  for (const t of transfers) {
    if (t.amount <= eps) continue;
    let left = roundMoney2(t.amount);
    const orderQueue = t.orderId ? [t.orderId] : orderIdsOldestFirst;

    for (const orderId of orderQueue) {
      if (left <= eps) break;
      const fromIdx = rows.findIndex(
        (r) =>
          r.orderId === orderId &&
          r.currency === t.currency &&
          r.bucket === t.fromBucket &&
          r.remaining > eps,
      );
      if (fromIdx < 0) continue;
      const from = rows[fromIdx]!;
      const take = roundMoney2(Math.min(left, from.remaining));
      if (take <= eps) continue;

      from.remaining = roundMoney2(from.remaining - take);
      rows[fromIdx] = withMethodStatus(from);

      let toIdx = rows.findIndex(
        (r) => r.orderId === orderId && r.currency === t.currency && r.bucket === t.toBucket,
      );
      if (toIdx < 0) {
        rows.push(
          withMethodStatus({
            orderId,
            method: t.toBucket,
            bucket: t.toBucket,
            label: PAYMENT_BUCKET_LABELS[t.toBucket],
            currency: t.currency,
            planned: 0,
            paid: 0,
            remaining: take,
            status: "open",
          }),
        );
        toIdx = rows.length - 1;
      } else {
        const to = rows[toIdx]!;
        to.remaining = roundMoney2(to.remaining + take);
        rows[toIdx] = withMethodStatus(to);
      }

      applied.push({
        fromBucket: t.fromBucket,
        toBucket: t.toBucket,
        amount: take,
        currency: t.currency,
        orderId,
      });
      left = roundMoney2(left - take);
    }
  }

  return { balances: rows.map(withMethodStatus), transfersApplied: applied };
}

/** Single-currency matching. Ignores balances/entries/transfers of the other currency. */
export function applyPaymentMethodMatching(input: MatchingEngineInput): MatchingEngineResult {
  const eps = input.eps ?? MATCHING_EPS;
  const currency = input.currency ?? "USD";

  let working = input.balances
    .filter((b) => b.currency === currency)
    .map((b) => withMethodStatus({ ...b }));

  const otherBalances = input.balances
    .filter((b) => b.currency !== currency)
    .map((b) => withMethodStatus({ ...b }));

  let transfersApplied: DebtTransferInput[] = [];
  const scopedTransfers = (input.debtTransfers ?? []).filter((t) => t.currency === currency);

  if (scopedTransfers.length > 0) {
    const tr = applyDebtTransfersToBalances(
      working,
      scopedTransfers,
      input.orderIdsOldestFirst,
      eps,
    );
    working = tr.balances;
    transfersApplied = tr.transfersApplied;
  }

  const appliedLines: MethodApplyLine[] = [];
  const amountByOrderId = new Map<string, number>();
  let surplus = 0;

  const enteredScoped = input.enteredByBucket.filter(
    (e) => e.currency === currency && e.entered > eps,
  );

  for (const entered of enteredScoped) {
    let left = roundMoney2(entered.entered);

    for (const orderId of input.orderIdsOldestFirst) {
      if (left <= eps) break;
      const idx = working.findIndex(
        (r) =>
          r.orderId === orderId &&
          r.currency === currency &&
          r.bucket === entered.bucket &&
          r.remaining > eps,
      );
      if (idx < 0) continue;
      const row = working[idx]!;
      const take = roundMoney2(Math.min(left, row.remaining));
      if (take <= eps) continue;

      row.paid = roundMoney2(row.paid + take);
      row.remaining = roundMoney2(Math.max(0, row.remaining - take));
      working[idx] = withMethodStatus(row);

      appliedLines.push({
        orderId,
        bucket: entered.bucket,
        method: row.method,
        currency,
        amount: take,
      });
      amountByOrderId.set(orderId, roundMoney2((amountByOrderId.get(orderId) ?? 0) + take));
      left = roundMoney2(left - take);
    }

    if (left > eps) {
      surplus = roundMoney2(surplus + left);
    }
  }

  return {
    balances: [...otherBalances, ...working.map(withMethodStatus)],
    appliedLines,
    amountByOrderId,
    surplus,
    surplusCurrency: currency,
    transfersApplied,
  };
}

/**
 * Runs USD and ILS engines separately, then merges.
 * rateByOrderId is only for ILS→USD ledger Payment amount — not for Matching itself.
 */
export function applyDualCurrencyMatching(params: {
  balances: MethodBalanceRow[];
  enteredByBucket: EnteredBucketAmount[];
  orderIdsOldestFirst: string[];
  debtTransfers?: DebtTransferInput[] | null;
  rateByOrderId?: Map<string, number>;
  eps?: number;
}): DualCurrencyMatchingResult {
  const usd = applyPaymentMethodMatching({
    ...params,
    currency: "USD",
  });
  const ils = applyPaymentMethodMatching({
    balances: usd.balances,
    enteredByBucket: params.enteredByBucket,
    orderIdsOldestFirst: params.orderIdsOldestFirst,
    debtTransfers: params.debtTransfers,
    currency: "ILS",
    eps: params.eps,
  });

  const amountUsdByOrderId = new Map<string, number>();
  for (const [orderId, amt] of usd.amountByOrderId) {
    amountUsdByOrderId.set(orderId, roundMoney2(amt));
  }
  for (const [orderId, amtIls] of ils.amountByOrderId) {
    const rate = params.rateByOrderId?.get(orderId) ?? 0;
    const asUsd = rate > 0 ? roundMoney2(amtIls / rate) : 0;
    if (asUsd <= MATCHING_EPS) continue;
    amountUsdByOrderId.set(orderId, roundMoney2((amountUsdByOrderId.get(orderId) ?? 0) + asUsd));
  }

  return {
    usd,
    ils,
    balances: ils.balances,
    appliedLines: [...usd.appliedLines, ...ils.appliedLines],
    transfersApplied: [...usd.transfersApplied, ...ils.transfersApplied],
    surplusUsd: usd.surplus,
    surplusIls: ils.surplus,
    amountUsdByOrderId,
  };
}

export function methodBalanceFromBreakdownRow(params: {
  breakdownId: string;
  orderId: string;
  paymentMethod: string;
  amount: number;
  currency: string;
  paidAmount: number;
  remainingAmount: number | null;
}): MethodBalanceRow {
  const currency = normalizeMatchingCurrency(params.currency);
  const planned = roundMoney2(Math.max(0, params.amount));
  const paid = roundMoney2(Math.max(0, params.paidAmount));
  const remaining =
    params.remainingAmount != null
      ? roundMoney2(Math.max(0, params.remainingAmount))
      : roundMoney2(Math.max(0, planned - paid));
  const bucket = paymentMethodBucketKey(params.paymentMethod);
  return withMethodStatus({
    breakdownId: params.breakdownId,
    orderId: params.orderId,
    method: params.paymentMethod,
    bucket,
    label: PAYMENT_BUCKET_LABELS[bucket],
    currency,
    planned,
    paid,
    remaining,
    status: "open",
  });
}
