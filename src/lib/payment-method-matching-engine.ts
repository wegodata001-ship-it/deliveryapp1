/**
 * Payment Method Matching Engine — מקור אמת יחיד לאמצעי תשלום.
 *
 * כלל עסקי קריטי: הפרדה מלאה בין מטבעות.
 *   Matching Engine USD ↔ רק אמצעי/תשלומי USD
 *   Matching Engine ILS ↔ רק אמצעי/תשלומי ILS
 * אין קיזוז, העברת חוב, Remaining או עודף בין מטבעות.
 */

import {
  PAYMENT_BUCKET_LABELS,
  paymentMethodBucketKey,
  type BreakdownCurrency,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";

export const MATCHING_EPS = CASH_CONTROL_EPS;

export type MethodBalanceStatus = "paid" | "partial" | "open";

/** מצב אמצעי אחד במטבע המקורי של השורה */
export type MethodBalanceRow = {
  breakdownId?: string;
  orderId: string;
  method: string;
  bucket: PaymentBucketKey;
  label: string;
  currency: BreakdownCurrency;
  /** מתוכנן במטבע השורה */
  planned: number;
  /** שולם במטבע השורה */
  paid: number;
  /** נותר במטבע השורה */
  remaining: number;
  status: MethodBalanceStatus;
};

export type EnteredBucketAmount = {
  bucket: PaymentBucketKey;
  label: string;
  currency: BreakdownCurrency;
  /** סכום שהוזן במטבע הנקוב — ללא המרה */
  entered: number;
};

export type DebtTransferInput = {
  fromBucket: PaymentBucketKey;
  toBucket: PaymentBucketKey;
  /** סכום במטבע של ההעברה */
  amount: number;
  currency: BreakdownCurrency;
  orderId?: string;
};

export type MatchingEngineInput = {
  balances: MethodBalanceRow[];
  enteredByBucket: EnteredBucketAmount[];
  orderIdsOldestFirst: string[];
  debtTransfers?: DebtTransferInput[] | null;
  /** אם מוגדר — מריצים רק על מטבע זה */
  currency?: BreakdownCurrency;
  eps?: number;
};

export type MethodApplyLine = {
  orderId: string;
  bucket: PaymentBucketKey;
  method: string;
  currency: BreakdownCurrency;
  amount: number;
};

export type MatchingEngineResult = {
  balances: MethodBalanceRow[];
  appliedLines: MethodApplyLine[];
  /** סכום שיושם להזמנה במטבע הריצה (לא מומר) */
  amountByOrderId: Map<string, number>;
  surplus: number;
  surplusCurrency: BreakdownCurrency;
  transfersApplied: DebtTransferInput[];
};

export type DualCurrencyMatchingResult = {
  usd: MatchingEngineResult;
  ils: MatchingEngineResult;
  /** כל היתרות אחרי שני המנועים */
  balances: MethodBalanceRow[];
  appliedLines: MethodApplyLine[];
  transfersApplied: DebtTransferInput[];
  surplusUsd: number;
  surplusIls: number;
  /**
   * הקצאה ל-Payment (ledger הזמנה ב-USD):
   * USD applied + ILS applied מומר ל-USD לפי rate לפי הזמנה.
   */
  amountUsdByOrderId: Map<string, number>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function deriveMethodStatus(paid: number, remaining: number): MethodBalanceStatus {
  if (remaining <= MATCHING_EPS) return "paid";
  if (paid > MATCHING_EPS) return "partial";
  return "open";
}

export function withMethodStatus(row: MethodBalanceRow): MethodBalanceRow {
  return {
    ...row,
    paid: round2(row.paid),
    remaining: round2(Math.max(0, row.remaining)),
    planned: round2(row.planned),
    status: deriveMethodStatus(row.paid, row.remaining),
  };
}

export function normalizeBreakdownCurrency(raw: string | null | undefined): BreakdownCurrency {
  return (raw ?? "USD").toUpperCase() === "ILS" ? "ILS" : "USD";
}

/**
 * העברת חוב — רק בתוך אותו מטבע.
 * העברה בין מטבעות נדחית בשתיקה (לא מיושמת).
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
    let left = round2(t.amount);
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
      const take = round2(Math.min(left, from.remaining));
      if (take <= eps) continue;

      from.remaining = round2(from.remaining - take);
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
        to.remaining = round2(to.remaining + take);
        rows[toIdx] = withMethodStatus(to);
      }

      applied.push({
        fromBucket: t.fromBucket,
        toBucket: t.toBucket,
        amount: take,
        currency: t.currency,
        orderId,
      });
      left = round2(left - take);
    }
  }

  return { balances: rows.map(withMethodStatus), transfersApplied: applied };
}

/**
 * Matching Engine למטבע יחיד.
 * מתעלם מיתרות/הקלדות/העברות של מטבע אחר.
 */
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
    let left = round2(entered.entered);

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
      const take = round2(Math.min(left, row.remaining));
      if (take <= eps) continue;

      row.paid = round2(row.paid + take);
      row.remaining = round2(Math.max(0, row.remaining - take));
      working[idx] = withMethodStatus(row);

      appliedLines.push({
        orderId,
        bucket: entered.bucket,
        method: row.method,
        currency,
        amount: take,
      });
      amountByOrderId.set(orderId, round2((amountByOrderId.get(orderId) ?? 0) + take));
      left = round2(left - take);
    }

    if (left > eps) {
      surplus = round2(surplus + left);
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
 * מריץ שני מנועים נפרדים ומאחד תוצאות.
 * rateByOrderId — רק להמרת ILS→USD לצורך רשומת Payment על ההזמנה (לא ל-Matching).
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
    amountUsdByOrderId.set(orderId, round2(amt));
  }
  for (const [orderId, amtIls] of ils.amountByOrderId) {
    const rate = params.rateByOrderId?.get(orderId) ?? 0;
    const asUsd = rate > 0 ? round2(amtIls / rate) : 0;
    if (asUsd <= MATCHING_EPS) continue;
    amountUsdByOrderId.set(orderId, round2((amountUsdByOrderId.get(orderId) ?? 0) + asUsd));
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
  const currency = normalizeBreakdownCurrency(params.currency);
  const planned = round2(Math.max(0, params.amount));
  const paid = round2(Math.max(0, params.paidAmount));
  const remaining =
    params.remainingAmount != null
      ? round2(Math.max(0, params.remainingAmount))
      : round2(Math.max(0, planned - paid));
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

/** תאימות לאחור — שמות ישנים בטסטים/קריאות */
export type MatchingEngineResultLegacy = MatchingEngineResult;
