import { prisma } from "@/lib/prisma";
import {
  toMoney,
  type FinanceMethodAllocationRecord,
  type MoneyCurrency,
} from "@/lib/finance-data/types";

function normalizeCurrency(raw: string | null | undefined): MoneyCurrency {
  return (raw ?? "USD").trim().toUpperCase() === "ILS" ? "ILS" : "USD";
}

function mapAllocation(row: {
  id: string;
  paymentId: string;
  method: string;
  currency: string;
  sourceAmount: unknown;
  amountUsd: unknown;
}): FinanceMethodAllocationRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    method: row.method,
    currency: normalizeCurrency(row.currency),
    sourceAmount: toMoney(row.sourceAmount as { toNumber(): number } | number | null),
    amountUsd: toMoney(row.amountUsd as { toNumber(): number } | number | null),
  };
}

/**
 * Optional support for Matching attribution.
 * Screens must not query this table directly — only via this repository.
 */
export type PaymentMethodAllocationRepository = {
  findByPaymentId(paymentId: string): Promise<FinanceMethodAllocationRecord[]>;
  findByPaymentIds(paymentIds: string[]): Promise<FinanceMethodAllocationRecord[]>;
};

export const paymentMethodAllocationRepository: PaymentMethodAllocationRepository = {
  async findByPaymentId(paymentId) {
    const rows = await prisma.paymentMethodAllocation.findMany({
      where: { paymentId },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(mapAllocation);
  },

  async findByPaymentIds(paymentIds) {
    if (paymentIds.length === 0) return [];
    const rows = await prisma.paymentMethodAllocation.findMany({
      where: { paymentId: { in: paymentIds } },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(mapAllocation);
  },
};
