import { calculateCustomerBalances } from "@/lib/customer-balance-calculator";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import {
  ORDER_DEBT_EPS,
  collectibleRemainingUsdByOrderId,
  computeOrderOpenDebtUsd,
  resolveOrderTotalUsd,
} from "@/lib/order-remaining-debt";
import { OS } from "@/lib/order-status-slugs";
import { customerDebtPaymentsWhere } from "@/lib/payment-adjustment-fee";
import { groupByActivePayments } from "@/lib/payment-record-status";
import { prisma } from "@/lib/prisma";

/**
 * יתרה לגבייה לפי הזמנה — אחרי תשלומים + משיכת חוב FIFO ברמת לקוח.
 * רק לקוחות עם משיכה נטענים במלואם; בלי משיכה המפה ריקה והרשימה נשארת על total−paid.
 */
export async function loadCollectibleRemainingUsdByOrderId(
  customerIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(customerIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const balances = await calculateCustomerBalances(ids);
  const withWithdrawal = ids.filter(
    (id) => Number(balances.get(id)?.totalWithdrawals ?? 0) > ORDER_DEBT_EPS,
  );
  if (withWithdrawal.length === 0) return out;

  const orders = await prisma.order.findMany({
    where: {
      customerId: { in: withWithdrawal },
      deletedAt: null,
      status: { not: OS.CANCELLED },
    },
    select: {
      id: true,
      customerId: true,
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      orderDate: true,
      createdAt: true,
    },
  });

  const regular = orders.filter((o) => !isDebtWithdrawalOrderStatus(o.status));
  if (regular.length === 0) return out;

  const paidSums = await groupByActivePayments(
    "orderId",
    {
      orderId: { in: regular.map((o) => o.id) },
      ...customerDebtPaymentsWhere,
    },
    { amountUsd: true },
  );
  const paidByOrder = new Map<string, number>();
  for (const row of paidSums) {
    if (row.orderId) paidByOrder.set(row.orderId, Number(row._sum.amountUsd ?? 0));
  }

  const byCustomer = new Map<string, typeof regular>();
  for (const order of regular) {
    if (!order.customerId) continue;
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  for (const [customerId, list] of byCustomer) {
    const sorted = [...list].sort((a, b) => {
      const ta = (a.orderDate ?? a.createdAt ?? new Date(0)).getTime();
      const tb = (b.orderDate ?? b.createdAt ?? new Date(0)).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    const remaining = collectibleRemainingUsdByOrderId(
      sorted.map((order) => ({
        orderId: order.id,
        remainingAfterPaymentsUsd: computeOrderOpenDebtUsd(
          resolveOrderTotalUsd(order),
          paidByOrder.get(order.id) ?? 0,
        ),
      })),
      Number(balances.get(customerId)?.totalWithdrawals ?? 0),
    );
    for (const [orderId, usd] of remaining) out.set(orderId, usd);
  }

  return out;
}
