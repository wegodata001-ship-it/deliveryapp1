/**
 * כרטסת עמלות לקוח — תנועות + יתרה רצה.
 * יתרה נוכחית = SUM(getCustomerCommissionMovements הפעילים).
 */
import { prisma } from "@/lib/prisma";
import { isLegacyCommissionOrderMutationFee } from "@/lib/customer-commission-balance-shared";
import {
  computeOrderCommissionBreakdown,
  summarizeCustomerOrderCommissions,
  type OrderCommissionBreakdown,
} from "@/lib/order-commission-ssot";
import {
  projectCustomerCommissionMovements,
  sumActiveCommissionMovementUsd,
  type CommissionMovementRow,
} from "@/lib/customer-commission-movements";

export type {
  CommissionMovementType,
  CommissionMovementDirection,
  CommissionMovementRow,
} from "@/lib/customer-commission-movements";
export {
  projectCustomerCommissionMovements,
  sumActiveCommissionMovementUsd,
} from "@/lib/customer-commission-movements";

export async function getCustomerCommissionMovements(
  customerId: string,
): Promise<CommissionMovementRow[]> {
  const cid = customerId.trim();
  if (!cid) return [];

  const [orders, fees] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: cid, deletedAt: null },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        commissionUsd: true,
        createdAt: true,
      },
    }),
    prisma.paymentAdjustmentFee.findMany({
      where: { customerId: cid },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        orderId: true,
        paymentId: true,
        paymentCaptureCode: true,
        sourceDocumentCode: true,
        amountUsd: true,
        reason: true,
        userChoice: true,
        notes: true,
        status: true,
        createdAt: true,
        createdById: true,
        createdBy: { select: { fullName: true } },
        payment: { select: { paymentCode: true } },
      },
    }),
  ]);

  return projectCustomerCommissionMovements({
    customerId: cid,
    orders,
    fees: fees.map((f) => ({
      ...f,
      reason: String(f.reason),
    })),
  });
}

export type CustomerCommissionLedgerPayload = {
  customerId: string;
  currentBalanceUsd: number;
  movements: CommissionMovementRow[];
  /** פירוט לפי הזמנה — מקורית / שינויים / נוכחית */
  orderRows: Array<OrderCommissionBreakdown & { orderNumber: string }>;
  orderSummary: { baseUsd: number; adjustmentsUsd: number; currentUsd: number };
};

const EPS = 0.001;

/** בונה תנועות עמלה מאותו מקור כמו Fee SSOT. */
export async function buildCustomerCommissionLedger(
  customerId: string,
): Promise<CustomerCommissionLedgerPayload> {
  const cid = customerId.trim();
  if (!cid) {
    return {
      customerId: "",
      currentBalanceUsd: 0,
      movements: [],
      orderRows: [],
      orderSummary: { baseUsd: 0, adjustmentsUsd: 0, currentUsd: 0 },
    };
  }

  const [movements, orders, fees] = await Promise.all([
    getCustomerCommissionMovements(cid),
    prisma.order.findMany({
      where: { customerId: cid, deletedAt: null },
      orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        commissionUsd: true,
      },
    }),
    prisma.paymentAdjustmentFee.findMany({
      where: { customerId: cid, status: { not: "CANCELLED" } },
      select: {
        orderId: true,
        amountUsd: true,
        userChoice: true,
      },
    }),
  ]);

  const currentBalanceUsd = sumActiveCommissionMovementUsd(movements);

  const feesByOrder = new Map<string, Array<{ amountUsd: number; userChoice: string | null }>>();
  for (const f of fees) {
    if (!f.orderId || isLegacyCommissionOrderMutationFee(f.userChoice)) continue;
    const list = feesByOrder.get(f.orderId) ?? [];
    list.push({ amountUsd: Number(f.amountUsd ?? 0), userChoice: f.userChoice });
    feesByOrder.set(f.orderId, list);
  }

  const orderRows = orders
    .map((o) => {
      const breakdown = computeOrderCommissionBreakdown({
        orderId: o.id,
        baseCommissionUsd: Number(o.commissionUsd ?? 0),
        fees: feesByOrder.get(o.id) ?? [],
      });
      if (Math.abs(breakdown.currentCommissionUsd) <= EPS && !breakdown.hasAdjustments) {
        return null;
      }
      return {
        ...breakdown,
        orderNumber: o.orderNumber?.trim() || o.id.slice(0, 8),
      };
    })
    .filter((row): row is OrderCommissionBreakdown & { orderNumber: string } => row != null);

  const orderSummary = summarizeCustomerOrderCommissions(orderRows);

  return {
    customerId: cid,
    currentBalanceUsd,
    movements,
    orderRows,
    orderSummary,
  };
}
