/**
 * Aggregate payment-method lines for PMC / reports.
 * Callers pass the SAME rows the table renders (after filters) — no parallel math.
 */

import { roundMoney2, type MoneyCurrency } from "@/lib/finance-data/types";

export type PaymentMethodSummaryInput = {
  paymentMethod: string;
  label: string;
  currency: MoneyCurrency;
  planned: number;
  paid: number;
  remaining: number;
};

export type PaymentMethodSummaryLine = {
  id: string;
  paymentMethod: string;
  label: string;
  currency: MoneyCurrency;
  planned: number;
  paid: number;
  remaining: number;
};

export type PaymentMethodSummaryTotals = {
  plannedUsd: number;
  paidUsd: number;
  remainingUsd: number;
  plannedIls: number;
  paidIls: number;
  remainingIls: number;
};

export type PaymentMethodSummaryResult = {
  byMethod: PaymentMethodSummaryLine[];
  totals: PaymentMethodSummaryTotals;
};

const METHOD_SORT: Record<string, number> = {
  CASH: 1,
  BANK_TRANSFER: 2,
  CREDIT: 3,
  CHECK: 4,
  OTHER: 5,
};

function sortKey(method: string, currency: MoneyCurrency): string {
  const rank = METHOD_SORT[method] ?? 50;
  return `${String(rank).padStart(2, "0")}:${currency}:${method}`;
}

/**
 * Group planned / paid / remaining by payment method × currency.
 * Totals are the sum of the grouped lines (identical to summing the input rows).
 */
export function summarizePaymentMethodLines(
  lines: PaymentMethodSummaryInput[],
): PaymentMethodSummaryResult {
  const map = new Map<string, PaymentMethodSummaryLine>();

  for (const line of lines) {
    const currency: MoneyCurrency = line.currency === "ILS" ? "ILS" : "USD";
    const method = (line.paymentMethod || "OTHER").trim() || "OTHER";
    const id = `${currency}:${method}`;
    const planned = roundMoney2(line.planned);
    const paid = roundMoney2(line.paid);
    const remaining = roundMoney2(line.remaining);
    const prev = map.get(id);
    if (!prev) {
      map.set(id, {
        id,
        paymentMethod: method,
        label: line.label || method,
        currency,
        planned,
        paid,
        remaining,
      });
    } else {
      prev.planned = roundMoney2(prev.planned + planned);
      prev.paid = roundMoney2(prev.paid + paid);
      prev.remaining = roundMoney2(prev.remaining + remaining);
    }
  }

  const byMethod = [...map.values()].sort((a, b) =>
    sortKey(a.paymentMethod, a.currency).localeCompare(sortKey(b.paymentMethod, b.currency)),
  );

  let plannedUsd = 0;
  let paidUsd = 0;
  let remainingUsd = 0;
  let plannedIls = 0;
  let paidIls = 0;
  let remainingIls = 0;
  for (const row of byMethod) {
    if (row.currency === "ILS") {
      plannedIls += row.planned;
      paidIls += row.paid;
      remainingIls += row.remaining;
    } else {
      plannedUsd += row.planned;
      paidUsd += row.paid;
      remainingUsd += row.remaining;
    }
  }

  return {
    byMethod,
    totals: {
      plannedUsd: roundMoney2(plannedUsd),
      paidUsd: roundMoney2(paidUsd),
      remainingUsd: roundMoney2(remainingUsd),
      plannedIls: roundMoney2(plannedIls),
      paidIls: roundMoney2(paidIls),
      remainingIls: roundMoney2(remainingIls),
    },
  };
}
