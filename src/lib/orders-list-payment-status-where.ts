import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { groupByActivePayments } from "@/lib/payment-record-status";
import {
  classifyOrderPaymentStatusFilter,
  isOrderPaymentStatusFilterValue,
  type OrderPaymentStatusFilterValue,
} from "@/lib/order-payment-status-filter";
import { OS } from "@/lib/order-status-slugs";
import { resolveOrderTotalUsd } from "@/lib/order-remaining-debt";

type PaymentSumRow = {
  orderId: string | null;
  _sum: { amountUsd: Prisma.Decimal | null };
};

/**
 * מסנן סטטוס תשלום לפי Ledger — מחזיר id-ים תואמים בתוך טווח ה־where הנתון.
 * null = אין מסנן פעיל.
 */
export async function resolveOrderIdsForPaymentStatusFilter(
  baseWhere: Prisma.OrderWhereInput,
  paymentStatusRaw: string[],
): Promise<string[] | null> {
  const wanted = new Set(
    paymentStatusRaw
      .map((v) => v.trim())
      .filter(isOrderPaymentStatusFilterValue) as OrderPaymentStatusFilterValue[],
  );
  if (wanted.size === 0) return null;

  const orders = await prisma.order.findMany({
    where: baseWhere,
    select: {
      id: true,
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
    },
  });
  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const paySums =
    ids.length > 0
      ? ((await groupByActivePayments(
          "orderId",
          { orderId: { in: ids }, amountUsd: { not: null } },
          { amountUsd: true },
        )) as PaymentSumRow[])
      : [];
  const paidByOrder = new Map<string, number>();
  for (const p of paySums) {
    if (p.orderId) paidByOrder.set(p.orderId, Number(p._sum.amountUsd ?? 0));
  }

  const matched: string[] = [];
  for (const o of orders) {
    const isDw = o.status === OS.DEBT_WITHDRAWAL;
    const totalUsd = resolveOrderTotalUsd(o);
    const paidUsd = isDw ? 0 : (paidByOrder.get(o.id) ?? 0);
    const status = isDw
      ? ("paid" as const)
      : classifyOrderPaymentStatusFilter({ totalUsd, paidUsd });
    if (wanted.has(status)) matched.push(o.id);
  }
  return matched;
}
