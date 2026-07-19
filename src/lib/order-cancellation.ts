import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { recordActivityAudit } from "@/lib/activity-audit";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import {
  getCustomerInternalBalanceUsd,
  persistCustomerBalanceSnapshot,
} from "@/lib/customer-open-debt";
import { orderCancellationReversalInternalUsd } from "@/lib/order-cancellation-math";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { OS } from "@/lib/order-status-slugs";
import { prisma } from "@/lib/prisma";

type Tx = Pick<typeof prisma, "order" | "auditLog">;

export const ORDER_CANCEL_LEDGER_LABEL = "ביטול הזמנה באישור מנהל";
export const ORDER_CANCELLED_AUDIT_ACTION = "OrderCancelled";

export { expectedInternalBalanceAfterOrderCancel, orderCancellationReversalInternalUsd } from "@/lib/order-cancellation-math";

const BALANCE_EPS = new Prisma.Decimal("0.02");

export type ExecuteOrderCancellationResult = {
  orderId: string;
  orderNumber: string | null;
  customerId: string;
  orderAmountUsd: string;
  balanceBeforeInternalUsd: string;
  balanceAfterInternalUsd: string;
  approvedBy: string;
};

/** ביטול הזמנה — לשימוש לאחר אישור מנהל בלבד */
export async function executeOrderCancellation(params: {
  orderId: string;
  actorUserId: string;
  actorFullName: string;
  reason?: string | null;
  orderEditRequestId?: string;
  directByAdmin?: boolean;
  /** הסטטוס כבר עודכן ל-CANCELLED באותו תהליך */
  statusAlreadyCancelled?: boolean;
  /** נדרש כש-statusAlreadyCancelled — לחישוב סכום הביטול */
  priorStatus?: string;
  balanceBeforeInternalUsd?: Prisma.Decimal | string | number;
  tx?: Tx;
}): Promise<ExecuteOrderCancellationResult> {
  const oid = params.orderId.trim();
  if (!oid) throw new Error("חסר מזהה הזמנה");

  const row = await prisma.order.findFirst({
    where: { id: oid, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      status: true,
      totalUsd: true,
      amountUsd: true,
      commissionUsd: true,
      debtWithdrawalUsd: true,
    },
  });
  if (!row?.customerId) throw new Error("הזמנה לא נמצאה");
  if (row.status === OS.CANCELLED && !params.statusAlreadyCancelled) {
    throw new Error("ההזמנה כבר מבוטלת");
  }
  if (params.statusAlreadyCancelled && row.status !== OS.CANCELLED) {
    throw new Error("ההזמנה לא במצב מבוטל");
  }

  const reason = (params.reason ?? "").trim() || null;
  const now = new Date();
  const amountSourceStatus = params.priorStatus ?? row.status;
  const orderAmountUsd = orderCancellationReversalInternalUsd({
    status: amountSourceStatus,
    totalUsd: row.totalUsd,
    amountUsd: row.amountUsd,
    commissionUsd: row.commissionUsd,
    debtWithdrawalUsd: row.debtWithdrawalUsd,
  });
  const orderAmountDec = new Prisma.Decimal(orderAmountUsd.toFixed(4));

  let balanceBefore: Prisma.Decimal;
  if (params.balanceBeforeInternalUsd != null) {
    balanceBefore = new Prisma.Decimal(String(params.balanceBeforeInternalUsd)).toDecimalPlaces(2, 4);
  } else if (!params.statusAlreadyCancelled) {
    balanceBefore = await getCustomerInternalBalanceUsd(row.customerId);
  } else {
    throw new Error("חסרה יתרה לפני ביטול");
  }

  const run = async (tx: Tx) => {
    if (!params.statusAlreadyCancelled) {
      await tx.order.update({
        where: { id: row.id },
        data: {
          status: OS.CANCELLED,
          ...(isDebtWithdrawalOrderStatus(amountSourceStatus) ? { debtWithdrawalUsd: null } : {}),
        },
      });
    } else if (isDebtWithdrawalOrderStatus(amountSourceStatus)) {
      await tx.order.update({
        where: { id: row.id },
        data: { debtWithdrawalUsd: null },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: params.actorUserId,
        actionType: ORDER_CANCELLED_AUDIT_ACTION,
        entityType: "Order",
        entityId: row.id,
        oldValue: {
          status: params.priorStatus ?? row.status,
          orderNumber: row.orderNumber,
          totalUsd: row.totalUsd?.toString() ?? null,
        } as Prisma.InputJsonValue,
        newValue: {
          status: OS.CANCELLED,
          cancelledAt: now.toISOString(),
          cancelReason: reason,
        } as Prisma.InputJsonValue,
        metadata: {
          orderId: row.id,
          orderNumber: row.orderNumber,
          customerId: row.customerId,
          orderAmountUsd: orderAmountDec.toFixed(2),
          balanceBeforeInternalUsd: balanceBefore.toFixed(2),
          cancelReason: reason,
          orderEditRequestId: params.orderEditRequestId ?? null,
          approvedByManager: Boolean(params.orderEditRequestId),
          directByAdmin: params.directByAdmin === true,
          approvedBy: params.actorFullName,
          approvedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  };

  if (params.tx) {
    await run(params.tx);
  } else if (!params.statusAlreadyCancelled) {
    await prisma.$transaction(async (tx) => run(tx));
  } else {
    await run(prisma);
  }

  const balanceAfter = await getCustomerInternalBalanceUsd(row.customerId);
  const expectedAfter = balanceBefore.add(orderAmountDec).toDecimalPlaces(2, 4);
  const delta = expectedAfter.sub(balanceAfter).abs();
  if (delta.gt(BALANCE_EPS)) {
    console.error("[order-cancellation] balance mismatch", {
      orderId: row.id,
      customerId: row.customerId,
      balanceBefore: balanceBefore.toFixed(2),
      orderAmountUsd: orderAmountDec.toFixed(2),
      expectedAfter: expectedAfter.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
    });
  }

  await persistCustomerBalanceSnapshot(row.customerId, balanceAfter);

  recordActivityAudit({
    userId: params.actorUserId,
    actionType: ORDER_CANCELLED_AUDIT_ACTION,
    entityType: "Order",
    entityId: row.id,
    metadata: {
      orderId: row.id,
      orderNumber: row.orderNumber,
      customerId: row.customerId,
      orderAmountUsd: orderAmountDec.toFixed(2),
      balanceBeforeInternalUsd: balanceBefore.toFixed(2),
      balanceAfterInternalUsd: balanceAfter.toFixed(2),
      orderEditRequestId: params.orderEditRequestId ?? null,
      dateTime: now.toISOString(),
    },
  });

  revalidateAllKpiCaches();
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/source-tables/customers");
  revalidatePath("/admin/order-edit-requests");

  return {
    orderId: row.id,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    orderAmountUsd: orderAmountDec.toFixed(2),
    balanceBeforeInternalUsd: balanceBefore.toFixed(2),
    balanceAfterInternalUsd: balanceAfter.toFixed(2),
    approvedBy: params.actorFullName,
  };
}
