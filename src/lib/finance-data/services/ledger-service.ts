import {
  computeOpenDebtUsd,
  sumPaymentAmountUsd,
  type OrderLedgerSnapshot,
} from "@/lib/finance-data/ledger";
import {
  orderRepository,
  paymentRepository,
  orderPaymentBreakdownRepository,
} from "@/lib/finance-data/repositories";
import { roundMoney2 } from "@/lib/finance-data/types";
import type { OrderBalanceView } from "@/lib/finance-data/view-models";

/**
 * LedgerService — Open Debt from Order + ACTIVE Payments only.
 */
export type LedgerService = {
  getOrderLedger(orderId: string): Promise<OrderLedgerSnapshot | null>;
  getOrderBalanceView(orderId: string): Promise<OrderBalanceView | null>;
  getOrderBalanceViews(orderIds: string[]): Promise<OrderBalanceView[]>;
};

async function getOrderBalanceViews(orderIds: string[]): Promise<OrderBalanceView[]> {
  if (orderIds.length === 0) return [];
  const [orders, payments, breakdowns] = await Promise.all([
    orderRepository.findByIds(orderIds),
    paymentRepository.findActiveByOrderIds(orderIds),
    orderPaymentBreakdownRepository.findByOrderIds(orderIds),
  ]);

  const paidByOrder = new Map<string, number>();
  for (const p of payments) {
    if (!p.orderId) continue;
    paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amountUsd);
  }

  const hasBreakdown = new Set(breakdowns.map((b) => b.orderId));

  return orders.map((order) => {
    const totalUsd =
      order.totalUsd > 0
        ? order.totalUsd
        : roundMoney2(order.amountUsd + order.commissionUsd);
    const snap = computeOpenDebtUsd({
      orderId: order.id,
      totalUsd,
      paidUsd: paidByOrder.get(order.id) ?? 0,
    });
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      weekCode: order.weekCode,
      amountUsd: roundMoney2(order.amountUsd),
      commissionUsd: roundMoney2(order.commissionUsd),
      totalUsd: snap.totalUsd,
      paidUsd: snap.paidUsd,
      openDebtUsd: snap.openDebtUsd,
      status: snap.status,
      hasBreakdown: hasBreakdown.has(order.id),
    } satisfies OrderBalanceView;
  });
}

export const ledgerService: LedgerService = {
  async getOrderLedger(orderId) {
    const order = await orderRepository.findById(orderId);
    if (!order) return null;
    const payments = await paymentRepository.findActiveByOrderId(orderId);
    return computeOpenDebtUsd({
      orderId: order.id,
      totalUsd: order.totalUsd,
      paidUsd: sumPaymentAmountUsd(payments),
    });
  },

  async getOrderBalanceView(orderId) {
    const views = await getOrderBalanceViews([orderId]);
    return views[0] ?? null;
  },

  getOrderBalanceViews,
};
