import { Prisma, type OrderSourceCountry } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import { prisma } from "@/lib/prisma";

export type CustomerBalanceScope = {
  from?: Date | null;
  to?: Date | null;
  sourceCountry?: OrderSourceCountry | null;
};

export type CustomerBalanceCalculation = {
  customerId: string;
  ordersCount: number;
  totalOrders: Prisma.Decimal;
  totalWithdrawals: Prisma.Decimal;
  totalPayments: Prisma.Decimal;
  balance: Prisma.Decimal;
};

function dateWhere(field: "orderDate" | "paymentDate", scope: CustomerBalanceScope) {
  const range =
    scope.from || scope.to
      ? {
          ...(scope.from ? { gte: scope.from } : {}),
          ...(scope.to ? { lte: scope.to } : {}),
        }
      : undefined;
  return range ? { [field]: range } : {};
}

function orderUsd(o: {
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.totalUsd) return o.totalUsd;
  return (o.amountUsd ?? new Prisma.Decimal(0)).add(o.commissionUsd ?? new Prisma.Decimal(0));
}

function withdrawalUsd(o: {
  debtWithdrawalUsd: Prisma.Decimal | null;
  totalUsd: Prisma.Decimal | null;
  amountUsd: Prisma.Decimal | null;
  commissionUsd: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (o.debtWithdrawalUsd && o.debtWithdrawalUsd.gt(0)) return o.debtWithdrawalUsd;
  return orderUsd(o);
}

function paymentUsd(p: {
  amountUsd: Prisma.Decimal | null;
  amountIls: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
}): Prisma.Decimal {
  if (p.amountUsd && p.amountUsd.gt(0)) return p.amountUsd;
  if (p.amountIls && p.exchangeRate && p.exchangeRate.gt(0)) {
    return p.amountIls.div(p.exchangeRate).toDecimalPlaces(4, 4);
  }
  return new Prisma.Decimal(0);
}

export async function calculateCustomerBalances(
  customerIds: string[],
  scope: CustomerBalanceScope = {},
): Promise<Map<string, CustomerBalanceCalculation>> {
  const ids = Array.from(new Set(customerIds.map((id) => id.trim()).filter(Boolean)));
  const out = new Map<string, CustomerBalanceCalculation>();
  for (const id of ids) {
    out.set(id, {
      customerId: id,
      ordersCount: 0,
      totalOrders: new Prisma.Decimal(0),
      totalWithdrawals: new Prisma.Decimal(0),
      totalPayments: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(0),
    });
  }
  if (ids.length === 0) return out;

  const orderWhere = {
    customerId: { in: ids },
    deletedAt: null,
    ...dateWhere("orderDate", scope),
    ...(scope.sourceCountry ? { sourceCountry: scope.sourceCountry } : {}),
  } satisfies Prisma.OrderWhereInput;

  const paymentWhere = {
    customerId: { in: ids },
    isPaid: true,
    ...dateWhere("paymentDate", scope),
    ...(scope.sourceCountry
      ? {
          order: {
            deletedAt: null,
            sourceCountry: scope.sourceCountry,
          },
        }
      : {}),
  } satisfies Prisma.PaymentWhereInput;

  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        customerId: true,
        status: true,
        totalUsd: true,
        amountUsd: true,
        commissionUsd: true,
        debtWithdrawalUsd: true,
      },
    }),
    prisma.payment.findMany({
      where: paymentWhere,
      select: {
        customerId: true,
        amountUsd: true,
        amountIls: true,
        exchangeRate: true,
      },
    }),
  ]);

  for (const o of orders) {
    if (!o.customerId) continue;
    const row = out.get(o.customerId);
    if (!row) continue;
    if (o.status === OS.DEBT_WITHDRAWAL) {
      row.totalWithdrawals = row.totalWithdrawals.add(withdrawalUsd(o));
    } else {
      row.ordersCount += 1;
      row.totalOrders = row.totalOrders.add(orderUsd(o));
    }
  }

  for (const p of payments) {
    if (!p.customerId) continue;
    const row = out.get(p.customerId);
    if (!row) continue;
    row.totalPayments = row.totalPayments.add(paymentUsd(p));
  }

  for (const row of out.values()) {
    row.balance = row.totalOrders.sub(row.totalWithdrawals).sub(row.totalPayments);
  }

  return out;
}

export async function calculateCustomerBalance(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<CustomerBalanceCalculation> {
  const id = customerId.trim();
  const map = await calculateCustomerBalances(id ? [id] : [], scope);
  return (
    map.get(id) ?? {
      customerId: id,
      ordersCount: 0,
      totalOrders: new Prisma.Decimal(0),
      totalWithdrawals: new Prisma.Decimal(0),
      totalPayments: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(0),
    }
  );
}
