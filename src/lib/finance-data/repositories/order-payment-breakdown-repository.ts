import { prisma } from "@/lib/prisma";
import {
  toMoney,
  type FinanceBreakdownRecord,
  type MoneyCurrency,
} from "@/lib/finance-data/types";

function normalizeCurrency(raw: string | null | undefined): MoneyCurrency {
  return (raw ?? "USD").trim().toUpperCase() === "ILS" ? "ILS" : "USD";
}

function mapBreakdown(row: {
  id: string;
  orderId: string;
  paymentMethod: string;
  amount: unknown;
  currency: string;
  paidAmount: unknown;
  remainingAmount: unknown;
}): FinanceBreakdownRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    paymentMethod: row.paymentMethod,
    amount: toMoney(row.amount as { toNumber(): number } | number | null),
    currency: normalizeCurrency(row.currency),
    paidAmount: toMoney(row.paidAmount as { toNumber(): number } | number | null),
    remainingAmount:
      row.remainingAmount == null
        ? null
        : toMoney(row.remainingAmount as { toNumber(): number } | number),
  };
}

const breakdownSelect = {
  id: true,
  orderId: true,
  paymentMethod: true,
  amount: true,
  currency: true,
  paidAmount: true,
  remainingAmount: true,
} as const;

/**
 * Read-only repository for OrderPaymentBreakdown.
 * Phase 1: no writes — legacy capture/matching keep writing until migration.
 */
export type OrderPaymentBreakdownRepository = {
  findByOrderId(orderId: string): Promise<FinanceBreakdownRecord[]>;
  findByOrderIds(orderIds: string[]): Promise<FinanceBreakdownRecord[]>;
};

export const orderPaymentBreakdownRepository: OrderPaymentBreakdownRepository = {
  async findByOrderId(orderId) {
    const rows = await prisma.orderPaymentBreakdown.findMany({
      where: { orderId },
      select: breakdownSelect,
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(mapBreakdown);
  },

  async findByOrderIds(orderIds) {
    if (orderIds.length === 0) return [];
    const rows = await prisma.orderPaymentBreakdown.findMany({
      where: { orderId: { in: orderIds } },
      select: breakdownSelect,
      orderBy: [{ orderId: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapBreakdown);
  },
};
