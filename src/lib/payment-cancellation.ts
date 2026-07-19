import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { recordActivityAudit } from "@/lib/activity-audit";
import {
  getCustomerInternalBalanceUsd,
  persistCustomerBalanceSnapshot,
} from "@/lib/customer-open-debt";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";
import { prisma } from "@/lib/prisma";
import {
  ensurePaymentRecordStatusColumns,
  PAYMENT_RECORD_STATUS_ACTIVE,
  PAYMENT_RECORD_STATUS_CANCELLED,
} from "@/lib/payment-record-status";

type Tx = Pick<typeof prisma, "payment" | "auditLog">;

export type ExecutePaymentCancellationResult = {
  paymentId: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  customerId: string;
  customerBalanceUsd: string;
};

/** ביטול תשלום/חשבונית — לשימוש פנימי לאחר אישור מנהל בלבד */
export async function executePaymentCancellation(params: {
  paymentId: string;
  actorUserId: string;
  reason: string | null;
  approvalRequestId?: string;
  directByAdmin?: boolean;
  tx?: Tx;
}): Promise<ExecutePaymentCancellationResult> {
  await ensurePaymentRecordStatusColumns();

  const pid = params.paymentId.trim();
  if (!pid) throw new Error("חסר מזהה תשלום");

  const row = await prisma.payment.findFirst({
    where: { id: pid, customerId: { not: null } },
    select: {
      id: true,
      paymentCode: true,
      paymentNumber: true,
      customerId: true,
      status: true,
    },
  });
  if (!row?.customerId) throw new Error("תשלום לא נמצא");
  if (row.status === PAYMENT_RECORD_STATUS_CANCELLED) throw new Error("התשלום כבר בוטל");

  const reason = (params.reason ?? "").trim() || null;
  const now = new Date();
  const cancelWhere =
    row.paymentNumber != null ? { paymentNumber: row.paymentNumber } : { id: row.id };

  const run = async (tx: Tx) => {
    await tx.payment.updateMany({
      where: cancelWhere,
      data: {
        status: PAYMENT_RECORD_STATUS_CANCELLED,
        cancelledAt: now,
        cancelledById: params.actorUserId,
        cancelReason: reason,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: params.actorUserId,
        actionType: "PaymentCancelled",
        entityType: "Payment",
        entityId: row.id,
        oldValue: {
          status: PAYMENT_RECORD_STATUS_ACTIVE,
          paymentCode: row.paymentCode,
          paymentNumber: row.paymentNumber,
        } as Prisma.InputJsonValue,
        newValue: {
          status: PAYMENT_RECORD_STATUS_CANCELLED,
          cancelledAt: now.toISOString(),
          cancelReason: reason,
        } as Prisma.InputJsonValue,
        metadata: {
          paymentId: row.id,
          paymentNumber: row.paymentNumber,
          customerId: row.customerId,
          reason,
          approvalRequestId: params.approvalRequestId ?? null,
          approvedByManager: Boolean(params.approvalRequestId),
          directByAdmin: params.directByAdmin === true,
        } as Prisma.InputJsonValue,
      },
    });
  };

  if (params.tx) {
    await run(params.tx);
  } else {
    await prisma.$transaction(async (tx) => run(tx));
  }

  recordActivityAudit({
    userId: params.actorUserId,
    actionType: "PaymentCancelled",
    entityType: "Payment",
    entityId: row.id,
    metadata: {
      paymentId: row.id,
      paymentNumber: row.paymentNumber,
      customerId: row.customerId,
      reason,
      approvalRequestId: params.approvalRequestId ?? null,
      dateTime: now.toISOString(),
    },
  });

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(row.customerId);
  await persistCustomerBalanceSnapshot(row.customerId, customerBalanceUsd);

  revalidateAllKpiCaches();
  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/source-tables/payments");
  revalidatePath("/admin/invoice-cancel-requests");

  return {
    paymentId: row.id,
    paymentCode: row.paymentCode,
    paymentNumber: row.paymentNumber,
    customerId: row.customerId,
    customerBalanceUsd: customerBalanceUsd.toFixed(2),
  };
}

export const INVOICE_CANCEL_LEDGER_LABEL = "ביטול חשבונית באישור מנהל";
