import { prisma } from "@/lib/prisma";
import { toMoney, type FinanceOrderRecord } from "@/lib/finance-data/types";

function mapOrder(row: {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  customerCodeSnapshot: string | null;
  customerNameSnapshot: string | null;
  weekCode: string | null;
  countryCode: string;
  orderDate: Date | null;
  status: string;
  paymentMethod: string | null;
  totalUsd: unknown;
  commissionUsd: unknown;
  amountUsd: unknown;
  exchangeRate: unknown;
  isActive: boolean;
}): FinanceOrderRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    customerCodeSnapshot: row.customerCodeSnapshot,
    customerNameSnapshot: row.customerNameSnapshot,
    weekCode: row.weekCode,
    countryCode: row.countryCode,
    orderDate: row.orderDate,
    status: row.status,
    paymentMethod: row.paymentMethod,
    totalUsd: toMoney(row.totalUsd as { toNumber(): number } | number | null),
    commissionUsd: toMoney(row.commissionUsd as { toNumber(): number } | number | null),
    amountUsd: toMoney(row.amountUsd as { toNumber(): number } | number | null),
    exchangeRate: row.exchangeRate == null ? null : toMoney(row.exchangeRate as { toNumber(): number } | number),
    isActive: row.isActive,
  };
}

const orderSelect = {
  id: true,
  orderNumber: true,
  customerId: true,
  customerCodeSnapshot: true,
  customerNameSnapshot: true,
  weekCode: true,
  countryCode: true,
  orderDate: true,
  status: true,
  paymentMethod: true,
  totalUsd: true,
  commissionUsd: true,
  amountUsd: true,
  exchangeRate: true,
  isActive: true,
} as const;

export type OrderRepository = {
  findById(orderId: string): Promise<FinanceOrderRecord | null>;
  findByIds(orderIds: string[]): Promise<FinanceOrderRecord[]>;
  findByCustomerId(customerId: string, opts?: { activeOnly?: boolean }): Promise<FinanceOrderRecord[]>;
};

export const orderRepository: OrderRepository = {
  async findById(orderId) {
    const row = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: orderSelect,
    });
    return row ? mapOrder(row) : null;
  },

  async findByIds(orderIds) {
    if (orderIds.length === 0) return [];
    const rows = await prisma.order.findMany({
      where: { id: { in: orderIds }, deletedAt: null },
      select: orderSelect,
    });
    return rows.map(mapOrder);
  },

  async findByCustomerId(customerId, opts) {
    const rows = await prisma.order.findMany({
      where: {
        customerId,
        deletedAt: null,
        ...(opts?.activeOnly === false ? {} : { isActive: true }),
      },
      select: orderSelect,
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapOrder);
  },
};
