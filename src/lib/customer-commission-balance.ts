/**
 * SSOT — יתרת עמלות ללקוח (חיובי / שלילי / אפס).
 * סכום commissionUsd מהזמנות + תנועות עמלה עצמאיות (עודף→עמלות וכו').
 * תנועות fee_adjustment_negative (legacy) — כבר משוקפות ב-commissionUsd; לא מכפילים.
 * תנועות commission_pool_debit (חדש) — מקוזזות מיתרת העמלה בלבד; כלולות בסכום.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CustomerBalanceScope } from "@/lib/customer-balance-calculator";
import { activePaidPaymentWhere } from "@/lib/payment-record-status-shared";
import { computeOrderOpenDebtUsd, roundOrderMoney2 } from "@/lib/order-remaining-debt";
import { computeCommissionResetPreviewNumbers } from "@/lib/customer-commission-reset-preview";
import { isLegacyCommissionOrderMutationFee } from "@/lib/customer-commission-balance-shared";
import { getCustomerCommissionMovements } from "@/lib/customer-commission-ledger";
import { sumActiveCommissionMovementUsd } from "@/lib/customer-commission-movements";
import { OrderStatus as OS } from "@prisma/client";

function commissionDateFilter(scope: CustomerBalanceScope = {}): { gte?: Date; lte?: Date } | undefined {
  if (!scope.from && !scope.to) return undefined;
  return {
    ...(scope.from ? { gte: scope.from } : {}),
    ...(scope.to ? { lte: scope.to } : {}),
  };
}

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

export async function getCustomerCommissionBalanceUsd(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<number> {
  const cid = customerId.trim();
  if (!cid) return 0;
  const movements = await getCustomerCommissionMovements(cid, scope);
  return sumActiveCommissionMovementUsd(movements);
}

export async function getCustomerCommissionBalancesUsdMany(
  customerIds: string[],
  scope: CustomerBalanceScope = {},
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(customerIds.map((id) => id.trim()).filter(Boolean)));
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, 0);
  if (ids.length === 0) return out;

  const dateFilter = commissionDateFilter(scope);
  const [orderAggs, feeRows] = await Promise.all([
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: ids },
        deletedAt: null,
        ...(dateFilter ? { orderDate: dateFilter } : {}),
      },
      _sum: { commissionUsd: true },
    }),
    prisma.paymentAdjustmentFee.findMany({
      where: {
        customerId: { in: ids },
        status: { not: "CANCELLED" },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { customerId: true, amountUsd: true, userChoice: true },
    }),
  ]);

  for (const row of orderAggs) {
    const cid = row.customerId?.trim();
    if (!cid) continue;
    out.set(cid, Number(row._sum.commissionUsd ?? 0));
  }
  for (const row of feeRows) {
    if (isLegacyCommissionOrderMutationFee(row.userChoice)) continue;
    const cid = row.customerId?.trim();
    if (!cid) continue;
    out.set(cid, (out.get(cid) ?? 0) + Number(row.amountUsd ?? 0));
  }
  for (const [id, value] of out) {
    out.set(id, roundOrderMoney2(value));
  }
  return out;
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
  const { customerDebtPaymentsWhere } = await import("@/lib/payment-adjustment-fee");
  const paidAgg = await prisma.payment.groupBy({
    by: ["orderId"],
    where: {
      orderId: { in: orderIds },
      amountUsd: { not: null },
      ...activePaidPaymentWhere,
      ...customerDebtPaymentsWhere,
    },
    _sum: { amountUsd: true },
  });
  const paidByOrder = new Map<string, number>();
  for (const row of paidAgg) {
    if (row.orderId) paidByOrder.set(row.orderId, Number(row._sum.amountUsd ?? 0));
  }
  const { loadCollectibleRemainingUsdByOrderId } = await import(
    "@/lib/orders-list-collectible-remaining"
  );
  const collectibleByOrder = await loadCollectibleRemainingUsdByOrderId([cid]);

  const open: CustomerOpenDebtOrderRow[] = [];
  for (const o of orders) {
    const deal = Number(o.amountUsd ?? 0);
    const com = Number(o.commissionUsd ?? 0);
    const total = Number(o.totalUsd ?? deal + com);
    const paid = paidByOrder.get(o.id) ?? 0;
    const remaining = roundOrderMoney2(
      collectibleByOrder.get(o.id) ?? computeOrderOpenDebtUsd(total, paid),
    );
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
