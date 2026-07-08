/**
 * סיכום אמצעי תשלום לבקרת קופה — אגרגציה מנתוני הזמנות וקליטות (USD).
 */

import { orderUsdTotal } from "@/lib/customer-balance";
import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import type { Prisma } from "@prisma/client";
import {
  breakdownLineUsd,
  isCompositePaymentMethod,
  paymentMethodBucketKey,
  PAYMENT_BUCKET_LABELS,
  type PaymentBucketKey,
} from "@/lib/payment-breakdown-shared";

export type CashControlMethodSummaryStatus = "paid" | "remaining" | "excess" | "not-required";

export type CashControlMethodSummaryRow = {
  bucket: PaymentBucketKey;
  label: string;
  plannedUsd: number;
  receivedUsd: number;
  remainingUsd: number;
  excessUsd: number;
  status: CashControlMethodSummaryStatus;
};

export type CashControlMethodSummaryTotals = {
  plannedUsd: number;
  receivedUsd: number;
  remainingUsd: number;
  excessUsd: number;
};

export type CashControlMethodSummaryPayload = {
  rows: CashControlMethodSummaryRow[];
  totals: CashControlMethodSummaryTotals;
};

const DISPLAY_BUCKETS: PaymentBucketKey[] = ["CASH", "BANK_TRANSFER", "CREDIT", "CHECK"];

type SummaryOrderInput = {
  paymentMethod: string | null;
  totalUsd: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  commissionUsd: { toString(): string } | null;
  usdRateUsed: { toString(): string } | null;
  snapshotFinalDollarRate: { toString(): string } | null;
  exchangeRate: { toString(): string } | null;
  paymentBreakdown: {
    paymentMethod: string;
    amount: { toString(): string };
    currency: string;
  }[];
};

type SummaryPaymentInput = {
  amountUsd: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function orderRateN(order: SummaryOrderInput): number {
  const raw = order.usdRateUsed ?? order.snapshotFinalDollarRate ?? order.exchangeRate;
  const n = Number(raw?.toString() ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function paymentMethodKey(p: SummaryPaymentInput): string {
  return (p.paymentMethod || p.usdPaymentMethod || p.ilsPaymentMethod || "").trim();
}

function rowStatus(planned: number, received: number): CashControlMethodSummaryStatus {
  const excess = round2(Math.max(0, received - planned));
  const remaining = round2(Math.max(0, planned - received));
  if (planned <= CASH_CONTROL_EPS && received <= CASH_CONTROL_EPS) return "not-required";
  if (excess > CASH_CONTROL_EPS) return "excess";
  if (remaining > CASH_CONTROL_EPS) return "remaining";
  return "paid";
}

function aggregatePlanned(orders: SummaryOrderInput[]): Map<PaymentBucketKey, number> {
  const planned = new Map<PaymentBucketKey, number>();
  for (const o of orders) {
    if (o.paymentBreakdown.length > 0) {
      const rateN = orderRateN(o);
      for (const b of o.paymentBreakdown) {
        const usdVal =
          breakdownLineUsd(
            { amount: b.amount.toString(), currency: b.currency === "ILS" ? "ILS" : "USD" },
            rateN,
          ) ?? 0;
        if (usdVal <= 0) continue;
        const bucket = paymentMethodBucketKey(b.paymentMethod);
        planned.set(bucket, round2((planned.get(bucket) ?? 0) + usdVal));
      }
      continue;
    }
    const method = (o.paymentMethod ?? "").trim();
    if (!method || isCompositePaymentMethod(method)) continue;
    const total = Number(orderUsdTotal({
      totalUsd: o.totalUsd as Prisma.Decimal | null,
      amountUsd: o.amountUsd as Prisma.Decimal | null,
      commissionUsd: o.commissionUsd as Prisma.Decimal | null,
    }).toString()) || 0;
    if (total <= CASH_CONTROL_EPS) continue;
    const bucket = paymentMethodBucketKey(method);
    planned.set(bucket, round2((planned.get(bucket) ?? 0) + total));
  }
  return planned;
}

function aggregateReceived(payments: SummaryPaymentInput[]): Map<PaymentBucketKey, number> {
  const received = new Map<PaymentBucketKey, number>();
  for (const p of payments) {
    const amt = Number(p.amountUsd?.toString() ?? 0) || 0;
    if (amt <= CASH_CONTROL_EPS) continue;
    const method = paymentMethodKey(p);
    if (!method) continue;
    const bucket = paymentMethodBucketKey(method);
    received.set(bucket, round2((received.get(bucket) ?? 0) + amt));
  }
  return received;
}

export function buildCashControlMethodSummary(
  orders: SummaryOrderInput[],
  payments: SummaryPaymentInput[],
): CashControlMethodSummaryPayload {
  const plannedMap = aggregatePlanned(orders);
  const receivedMap = aggregateReceived(payments);

  const buckets: PaymentBucketKey[] = [...DISPLAY_BUCKETS];
  const otherPlanned = plannedMap.get("OTHER") ?? 0;
  const otherReceived = receivedMap.get("OTHER") ?? 0;
  if (otherPlanned > CASH_CONTROL_EPS || otherReceived > CASH_CONTROL_EPS) {
    buckets.push("OTHER");
  }

  const rows: CashControlMethodSummaryRow[] = buckets.map((bucket) => {
    const plannedUsd = round2(plannedMap.get(bucket) ?? 0);
    const receivedUsd = round2(receivedMap.get(bucket) ?? 0);
    const excessUsd = round2(Math.max(0, receivedUsd - plannedUsd));
    const remainingUsd = round2(Math.max(0, plannedUsd - receivedUsd));
    return {
      bucket,
      label: PAYMENT_BUCKET_LABELS[bucket],
      plannedUsd,
      receivedUsd,
      remainingUsd,
      excessUsd,
      status: rowStatus(plannedUsd, receivedUsd),
    };
  });

  const totals: CashControlMethodSummaryTotals = {
    plannedUsd: round2(rows.reduce((s, r) => s + r.plannedUsd, 0)),
    receivedUsd: round2(rows.reduce((s, r) => s + r.receivedUsd, 0)),
    remainingUsd: round2(rows.reduce((s, r) => s + r.remainingUsd, 0)),
    excessUsd: round2(rows.reduce((s, r) => s + r.excessUsd, 0)),
  };

  return { rows, totals };
}

export function fmtMethodSummaryUsd(n: number): string {
  if (n <= CASH_CONTROL_EPS) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtMethodSummaryExcess(n: number): string {
  if (n <= CASH_CONTROL_EPS) return "—";
  return `+$${n.toFixed(2)}`;
}
