import { deriveMethodStatus, paymentMethodBucketKey } from "@/lib/finance-data/matching";
import {
  orderPaymentBreakdownRepository,
  orderRepository,
  paymentMethodAllocationRepository,
  paymentRepository,
} from "@/lib/finance-data/repositories";
import { roundMoney2, type FinanceBreakdownRecord } from "@/lib/finance-data/types";
import type { PaymentMethodView } from "@/lib/finance-data/view-models";
import { validateBreakdown } from "@/lib/finance-data/validators";
import type { ValidationResult } from "@/lib/finance-data/validators";

function toMethodView(
  row: FinanceBreakdownRecord,
  orderNumber: string | null,
): PaymentMethodView {
  const planned = roundMoney2(row.amount);
  const paid = roundMoney2(row.paidAmount);
  const remaining =
    row.remainingAmount != null
      ? roundMoney2(Math.max(0, row.remainingAmount))
      : roundMoney2(Math.max(0, planned - paid));

  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber,
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    planned,
    paid,
    remaining,
    status: deriveMethodStatus(paid, remaining),
  };
}

/**
 * Legacy-compatible seed: when breakdown paidAmount is empty but ACTIVE payments
 * exist, attribute paid/remaining from PaymentMethodAllocation (same-currency).
 * Matches payment-intake-load mapOrderToIntakeRow behavior for parity.
 */
async function seedMethodsFromAllocations(
  methods: PaymentMethodView[],
  paidUsdByOrder: Map<string, number>,
): Promise<PaymentMethodView[]> {
  if (methods.length === 0) return methods;

  const byOrder = new Map<string, PaymentMethodView[]>();
  for (const m of methods) {
    const list = byOrder.get(m.orderId) ?? [];
    list.push(m);
    byOrder.set(m.orderId, list);
  }

  const orderIdsNeedingSeed: string[] = [];
  for (const [orderId, rows] of byOrder) {
    const persistedPaid = roundMoney2(rows.reduce((s, r) => s + r.paid, 0));
    const ledgerPaid = paidUsdByOrder.get(orderId) ?? 0;
    if (persistedPaid <= 0.005 && ledgerPaid > 0.005) {
      orderIdsNeedingSeed.push(orderId);
    }
  }
  if (orderIdsNeedingSeed.length === 0) return methods;

  const payments = await paymentRepository.findActiveByOrderIds(orderIdsNeedingSeed);
  const paymentIdToOrder = new Map(
    payments.filter((p) => p.orderId).map((p) => [p.id, p.orderId as string]),
  );
  const allocs = await paymentMethodAllocationRepository.findByPaymentIds(
    payments.map((p) => p.id),
  );

  const allocByOrderBucketCur = new Map<string, Map<string, number>>();
  for (const a of allocs) {
    const orderId = paymentIdToOrder.get(a.paymentId);
    if (!orderId) continue;
    const bucket = paymentMethodBucketKey(a.method);
    const amt = a.currency === "ILS" ? a.sourceAmount : a.amountUsd;
    if (!(amt > 0)) continue;
    let byBucket = allocByOrderBucketCur.get(orderId);
    if (!byBucket) {
      byBucket = new Map();
      allocByOrderBucketCur.set(orderId, byBucket);
    }
    const key = `${a.currency}:${bucket}`;
    byBucket.set(key, roundMoney2((byBucket.get(key) ?? 0) + amt));
  }

  return methods.map((m) => {
    if (!orderIdsNeedingSeed.includes(m.orderId)) return m;
    const byBucket = allocByOrderBucketCur.get(m.orderId);
    if (!byBucket) return m;
    const bucket = paymentMethodBucketKey(m.paymentMethod);
    const paid = roundMoney2(byBucket.get(`${m.currency}:${bucket}`) ?? 0);
    const remaining = roundMoney2(Math.max(0, m.planned - paid));
    return {
      ...m,
      paid,
      remaining,
      status: deriveMethodStatus(paid, remaining),
    };
  });
}

/**
 * PaymentBreakdownService — method split views from OrderPaymentBreakdown.
 * Does not define Open Debt (LedgerService does).
 */
export type PaymentBreakdownService = {
  getMethodViewsForOrder(orderId: string): Promise<PaymentMethodView[]>;
  getMethodViewsForOrders(orderIds: string[]): Promise<PaymentMethodView[]>;
  validateAgainstOpenDebt(orderId: string, openDebtUsd: number): Promise<ValidationResult>;
};

async function getMethodViewsForOrders(orderIds: string[]): Promise<PaymentMethodView[]> {
  if (orderIds.length === 0) return [];
  const [orders, rows, payments] = await Promise.all([
    orderRepository.findByIds(orderIds),
    orderPaymentBreakdownRepository.findByOrderIds(orderIds),
    paymentRepository.findActiveByOrderIds(orderIds),
  ]);
  const numberById = new Map(orders.map((o) => [o.id, o.orderNumber]));
  const paidUsdByOrder = new Map<string, number>();
  for (const p of payments) {
    if (!p.orderId) continue;
    paidUsdByOrder.set(p.orderId, (paidUsdByOrder.get(p.orderId) ?? 0) + p.amountUsd);
  }
  const base = rows.map((row) => toMethodView(row, numberById.get(row.orderId) ?? null));
  return seedMethodsFromAllocations(base, paidUsdByOrder);
}

export const paymentBreakdownService: PaymentBreakdownService = {
  async getMethodViewsForOrder(orderId) {
    return getMethodViewsForOrders([orderId]);
  },

  getMethodViewsForOrders,

  async validateAgainstOpenDebt(orderId, openDebtUsd) {
    const rows = await orderPaymentBreakdownRepository.findByOrderId(orderId);
    return validateBreakdown({ orderId, openDebtUsd, rows });
  },
};
