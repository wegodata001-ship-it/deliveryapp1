import { prisma } from "@/lib/prisma";
import { toMoney, type FinancePaymentRecord } from "@/lib/finance-data/types";

function mapPayment(row: {
  id: string;
  paymentCode: string | null;
  customerId: string | null;
  orderId: string | null;
  weekCode: string | null;
  countryCode: string;
  paymentDate: Date | null;
  currency: string;
  amountUsd: unknown;
  amountIls: unknown;
  sourceCurrency: string | null;
  sourceAmount: unknown;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  status: string;
  businessType: string;
  isPaid: boolean;
}): FinancePaymentRecord {
  return {
    id: row.id,
    paymentCode: row.paymentCode,
    customerId: row.customerId,
    orderId: row.orderId,
    weekCode: row.weekCode,
    countryCode: row.countryCode,
    paymentDate: row.paymentDate,
    currency: row.currency,
    amountUsd: toMoney(row.amountUsd as { toNumber(): number } | number | null),
    amountIls: toMoney(row.amountIls as { toNumber(): number } | number | null),
    sourceCurrency: row.sourceCurrency,
    sourceAmount:
      row.sourceAmount == null
        ? null
        : toMoney(row.sourceAmount as { toNumber(): number } | number),
    paymentMethod: row.paymentMethod,
    usdPaymentMethod: row.usdPaymentMethod,
    ilsPaymentMethod: row.ilsPaymentMethod,
    status: row.status,
    businessType: row.businessType,
    isPaid: row.isPaid,
  };
}

const paymentSelect = {
  id: true,
  paymentCode: true,
  customerId: true,
  orderId: true,
  weekCode: true,
  countryCode: true,
  paymentDate: true,
  currency: true,
  amountUsd: true,
  amountIls: true,
  sourceCurrency: true,
  sourceAmount: true,
  paymentMethod: true,
  usdPaymentMethod: true,
  ilsPaymentMethod: true,
  status: true,
  businessType: true,
  isPaid: true,
} as const;

/** Ledger payments: ACTIVE only (cancelled excluded from balances). */
const activePaymentWhere = { status: "ACTIVE" as const };

export type PaymentRepository = {
  findById(paymentId: string): Promise<FinancePaymentRecord | null>;
  findActiveByOrderId(orderId: string): Promise<FinancePaymentRecord[]>;
  findActiveByOrderIds(orderIds: string[]): Promise<FinancePaymentRecord[]>;
  findActiveByCustomerId(customerId: string): Promise<FinancePaymentRecord[]>;
  sumActiveAmountUsdByOrderId(orderId: string): Promise<number>;
};

export const paymentRepository: PaymentRepository = {
  async findById(paymentId) {
    const row = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: paymentSelect,
    });
    return row ? mapPayment(row) : null;
  },

  async findActiveByOrderId(orderId) {
    const rows = await prisma.payment.findMany({
      where: { orderId, ...activePaymentWhere },
      select: paymentSelect,
      orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapPayment);
  },

  async findActiveByOrderIds(orderIds) {
    if (orderIds.length === 0) return [];
    const rows = await prisma.payment.findMany({
      where: { orderId: { in: orderIds }, ...activePaymentWhere },
      select: paymentSelect,
      orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapPayment);
  },

  async findActiveByCustomerId(customerId) {
    const rows = await prisma.payment.findMany({
      where: { customerId, ...activePaymentWhere },
      select: paymentSelect,
      orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(mapPayment);
  },

  async sumActiveAmountUsdByOrderId(orderId) {
    const agg = await prisma.payment.aggregate({
      where: { orderId, ...activePaymentWhere },
      _sum: { amountUsd: true },
    });
    return toMoney(agg._sum.amountUsd);
  },
};
