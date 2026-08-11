import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { computeOrderLedgerView } from "@/lib/order-remaining-debt";

export type OrderClosureSnapshotRow = {
  orderId: string;
  orderNumber: string | null;
  totalUsd: number;
  paidUsd: number;
  remainingUsd: number;
  status: "paid" | "partial" | "unpaid";
};

function decNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0;
  if (v instanceof Prisma.Decimal) return Number(v.toString());
  return Number(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function loadOrderClosureSnapshot(orderIds: string[]): Promise<OrderClosureSnapshotRow[]> {
  const ids = [...new Set(orderIds.map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const [orders, paidAgg] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, orderNumber: true, totalUsd: true, amountUsd: true, commissionUsd: true },
    }),
    prisma.payment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: ids }, amountUsd: { not: null }, ...activePaidPaymentWhere },
      _sum: { amountUsd: true },
    }),
  ]);

  const paidByOrder = new Map<string, number>();
  for (const row of paidAgg) {
    if (!row.orderId) continue;
    paidByOrder.set(row.orderId, decNum(row._sum.amountUsd));
  }

  return orders.map((o) => {
    const paidUsd = paidByOrder.get(o.id) ?? 0;
    const ledger = computeOrderLedgerView({
      orderId: o.id,
      totalUsd: o.totalUsd,
      amountUsd: o.amountUsd,
      commissionUsd: o.commissionUsd,
      paidUsd,
    });
    const status: OrderClosureSnapshotRow["status"] = ledger.paymentStatus;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber?.trim() || null,
      totalUsd: ledger.totalUsd,
      paidUsd: ledger.paidUsd,
      remainingUsd: ledger.remainingUsd,
      status,
    };
  });
}

