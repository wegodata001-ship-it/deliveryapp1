/**
 * SSOT — יתרת עמלות ללקוח (חיובי / שלילי / אפס).
 * סכום commissionUsd מהזמנות + תנועות עמלה עצמאיות (עודף→עמלות וכו').
 * תנועות fee_adjustment_negative מקושרות להזמנה — כבר משוקפות ב-commissionUsd; לא מכפילים.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { computeOrderOpenDebtUsd, roundOrderMoney2 } from "@/lib/order-remaining-debt";
import { computeCommissionResetPreviewNumbers } from "@/lib/customer-commission-reset-preview";
import { OrderStatus as OS } from "@prisma/client";

export type CustomerOpenDebtOrderRow = {
  orderId: string;
  orderNumber: string;
  remainingUsd: number;
  commissionUsd: number;
  orderDateYmd: string;
};

export type CustomerCommissionResetPreview = {
  customerId: string;
  openDebtUsd: number;
  commissionBalanceUsd: number;
  resetUsd: number;
  commissionAfterUsd: number;
  orders: CustomerOpenDebtOrderRow[];
};

const EPS = 0.01;

export { computeCommissionResetPreviewNumbers } from "@/lib/customer-commission-reset-preview";

export async function getCustomerCommissionBalanceUsd(customerId: string): Promise<number> {
  const cid = customerId.trim();
  if (!cid) return 0;

  const [orderAgg, feeAgg] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId: cid, deletedAt: null },
      _sum: { commissionUsd: true },
    }),
    prisma.paymentAdjustmentFee.aggregate({
      where: {
        customerId: cid,
        status: { not: "CANCELLED" },
        NOT: { userChoice: "fee_adjustment_negative" },
      },
      _sum: { amountUsd: true },
    }),
  ]);

  const orderCommission = Number(orderAgg._sum.commissionUsd ?? 0);
  const feeSum = Number(feeAgg._sum.amountUsd ?? 0);
  return roundOrderMoney2(orderCommission + feeSum);
}

export async function loadCustomerOpenDebtOrdersFifo(
  customerId: string,
): Promise<CustomerOpenDebtOrderRow[]> {
  const cid = customerId.trim();
  if (!cid) return [];

  const orders = await prisma.order.findMany({
    where: {
      customerId: cid,
      deletedAt: null,
      status: { not: OS.DEBT_WITHDRAWAL },
    },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      amountUsd: true,
      commissionUsd: true,
      totalUsd: true,
    },
  });
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const paidAgg = await prisma.payment.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, amountUsd: { not: null }, ...activePaidPaymentWhere },
    _sum: { amountUsd: true },
  });
  const paidByOrder = new Map<string, number>();
  for (const row of paidAgg) {
    if (row.orderId) paidByOrder.set(row.orderId, Number(row._sum.amountUsd ?? 0));
  }

  const open: CustomerOpenDebtOrderRow[] = [];
  for (const o of orders) {
    const deal = Number(o.amountUsd ?? 0);
    const com = Number(o.commissionUsd ?? 0);
    const total = Number(o.totalUsd ?? deal + com);
    const paid = paidByOrder.get(o.id) ?? 0;
    const remaining = roundOrderMoney2(computeOrderOpenDebtUsd(total, paid));
    if (remaining <= EPS) continue;
    open.push({
      orderId: o.id,
      orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
      remainingUsd: remaining,
      commissionUsd: com,
      orderDateYmd: o.orderDate ? o.orderDate.toISOString().slice(0, 10) : "—",
    });
  }
  return open;
}

export async function buildCustomerCommissionResetPreview(
  customerId: string,
): Promise<CustomerCommissionResetPreview | null> {
  const cid = customerId.trim();
  if (!cid) return null;

  const [commissionBalanceUsd, orders] = await Promise.all([
    getCustomerCommissionBalanceUsd(cid),
    loadCustomerOpenDebtOrdersFifo(cid),
  ]);

  const openDebtUsd = roundOrderMoney2(orders.reduce((s, o) => s + o.remainingUsd, 0));
  const { resetUsd, commissionAfterUsd } = computeCommissionResetPreviewNumbers(
    openDebtUsd,
    commissionBalanceUsd,
  );

  return {
    customerId: cid,
    openDebtUsd,
    commissionBalanceUsd,
    resetUsd,
    commissionAfterUsd,
    orders,
  };
}
