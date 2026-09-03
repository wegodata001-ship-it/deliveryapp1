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
import { assertCancellationInvariant } from "@/lib/payment-cancellation-effects";
import {
  linkedCapturePaymentWhere,
  linkedCommissionFeeWhere,
  linkedCreditPaymentWhere,
} from "@/lib/payment-cancellation-fees";

export { linkedCommissionFeeWhere, linkedCreditPaymentWhere } from "@/lib/payment-cancellation-fees";

type CancellationTx = {
  payment: Prisma.TransactionClient["payment"];
  auditLog: Prisma.TransactionClient["auditLog"];
  paymentAdjustmentFee: Prisma.TransactionClient["paymentAdjustmentFee"];
  $queryRaw?: Prisma.TransactionClient["$queryRaw"];
};

export type ExecutePaymentCancellationResult = {
  paymentId: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  customerId: string;
  customerBalanceUsd: string;
  alreadyCancelled: boolean;
  reversedFeeIds: string[];
};

export type ExecutePaymentCancellationParams = {
  paymentId: string;
  actorUserId: string;
  reason: string | null;
  approvalRequestId?: string;
  directByAdmin?: boolean;
  tx?: CancellationTx;
  /** בדיקות בלבד — זורק אחרי ביטול Payment ולפני ביטול Fee, כדי לוודא ROLLBACK. */
  _testFailAfter?: "payment-cancelled";
};

async function lockPaymentRows(tx: CancellationTx, paymentId: string, customerId?: string, paymentNumber?: number | null) {
  if (!tx.$queryRaw) return;
  if (customerId && paymentNumber != null) {
    await tx.$queryRaw`
      SELECT id FROM "Payment"
      WHERE "customerId" = ${customerId} AND "paymentNumber" = ${paymentNumber}
      FOR UPDATE
    `;
    return;
  }
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
}

/** ביטול תשלום/חשבונית — לשימוש פנימי לאחר אישור מנהל בלבד */
export async function executePaymentCancellation(
  params: ExecutePaymentCancellationParams,
): Promise<ExecutePaymentCancellationResult> {
  await ensurePaymentRecordStatusColumns();

  const pid = params.paymentId.trim();
  if (!pid) throw new Error("חסר מזהה תשלום");

  const reason = (params.reason ?? "").trim() || null;
  const now = new Date();

  const run = async (tx: CancellationTx): Promise<Omit<ExecutePaymentCancellationResult, "customerBalanceUsd">> => {
    const preview = await tx.payment.findFirst({
      where: { id: pid, customerId: { not: null } },
      select: {
        id: true,
        paymentCode: true,
        paymentNumber: true,
        customerId: true,
        status: true,
      },
    });
    if (!preview?.customerId) throw new Error("תשלום לא נמצא");

    await lockPaymentRows(tx, preview.id, preview.customerId, preview.paymentNumber);

    const row = await tx.payment.findFirst({
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

    const empty = {
      paymentId: row.id,
      paymentCode: row.paymentCode,
      paymentNumber: row.paymentNumber,
      customerId: row.customerId,
      alreadyCancelled: true,
      reversedFeeIds: [] as string[],
    };

    if (row.status === PAYMENT_RECORD_STATUS_CANCELLED) {
      return empty;
    }

    const captureWhere = linkedCapturePaymentWhere({
      customerId: row.customerId,
      paymentIds: [row.id],
      paymentNumber: row.paymentNumber,
      paymentCaptureCode: row.paymentCode,
    });

    const batchRows = await tx.payment.findMany({
      where: captureWhere,
      select: {
        id: true,
        paymentCode: true,
        paymentNumber: true,
        customerId: true,
        businessType: true,
        status: true,
      },
    });
    const paymentIds = [...new Set(batchRows.map((p) => p.id))];
    const captureCode =
      row.paymentCode?.trim() ||
      batchRows.find((p) => p.paymentCode?.trim())?.paymentCode?.trim() ||
      null;

    const stillActiveIds = batchRows
      .filter((p) => p.status !== PAYMENT_RECORD_STATUS_CANCELLED)
      .map((p) => p.id);
    if (stillActiveIds.length === 0) {
      return empty;
    }

    await tx.payment.updateMany({
      where: { id: { in: stillActiveIds } },
      data: {
        status: PAYMENT_RECORD_STATUS_CANCELLED,
        cancelledAt: now,
        cancelledById: params.actorUserId,
        cancelReason: reason,
      },
    });

    if (params._testFailAfter === "payment-cancelled") {
      throw new Error("TEST_FAIL_AFTER_PAYMENT_CANCELLED");
    }

    const feeWhere = linkedCommissionFeeWhere({
      customerId: row.customerId,
      paymentIds,
      paymentCaptureCode: captureCode,
    });
    const linkedFees = await tx.paymentAdjustmentFee.findMany({
      where: feeWhere,
      select: { id: true, amountUsd: true, paymentCaptureCode: true, paymentId: true },
    });
    if (linkedFees.length > 0) {
      await tx.paymentAdjustmentFee.updateMany({
        where: { id: { in: linkedFees.map((f) => f.id) } },
        data: { status: "CANCELLED" },
      });
    }

    const leftoverPayments = await tx.payment.findMany({
      where: { ...captureWhere, status: { not: PAYMENT_RECORD_STATUS_CANCELLED } },
      select: {
        id: true,
        customerId: true,
        paymentNumber: true,
        paymentCode: true,
        businessType: true,
        status: true,
      },
    });
    const leftoverFees = await tx.paymentAdjustmentFee.findMany({
      where: feeWhere,
      select: {
        id: true,
        customerId: true,
        paymentId: true,
        paymentCaptureCode: true,
        status: true,
        amountUsd: true,
      },
    });
    const leftoverCredits = await tx.payment.findMany({
      where: linkedCreditPaymentWhere({
        customerId: row.customerId,
        paymentIds,
        paymentNumber: row.paymentNumber,
        paymentCaptureCode: captureCode,
      }),
      select: {
        id: true,
        customerId: true,
        paymentNumber: true,
        paymentCode: true,
        businessType: true,
        status: true,
      },
    });

    assertCancellationInvariant({
      cancelledPaymentIds: paymentIds,
      remainingActivePayments: leftoverPayments.map((p) => ({
        ...p,
        customerId: p.customerId ?? row.customerId!,
      })),
      remainingActiveFees: leftoverFees.map((f) => ({
        ...f,
        amountUsd: Number(f.amountUsd ?? 0),
      })),
      remainingActiveCredits: leftoverCredits.map((p) => ({
        ...p,
        customerId: p.customerId ?? row.customerId!,
      })),
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
          reversedFeeIds: linkedFees.map((f) => f.id),
          reversedFeeUsd: linkedFees.reduce((s, f) => s + Number(f.amountUsd ?? 0), 0),
          cancelledPaymentIds: stillActiveIds,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      paymentId: row.id,
      paymentCode: row.paymentCode,
      paymentNumber: row.paymentNumber,
      customerId: row.customerId,
      alreadyCancelled: false,
      reversedFeeIds: linkedFees.map((f) => f.id),
    };
  };

  const cancelled = params.tx
    ? await run(params.tx)
    : await prisma.$transaction(async (tx) => run(tx));

  if (!cancelled.alreadyCancelled) {
    recordActivityAudit({
      userId: params.actorUserId,
      actionType: "PaymentCancelled",
      entityType: "Payment",
      entityId: cancelled.paymentId,
      metadata: {
        paymentId: cancelled.paymentId,
        paymentNumber: cancelled.paymentNumber,
        customerId: cancelled.customerId,
        reason,
        approvalRequestId: params.approvalRequestId ?? null,
        dateTime: now.toISOString(),
      },
    });
  }

  const customerBalanceUsd = await getCustomerInternalBalanceUsd(cancelled.customerId);
  if (!cancelled.alreadyCancelled) {
    await persistCustomerBalanceSnapshot(cancelled.customerId, customerBalanceUsd);
    revalidateAllKpiCaches();
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");
    revalidatePath("/admin/source-tables/payments");
    revalidatePath("/admin/invoice-cancel-requests");
  }

  return {
    ...cancelled,
    customerBalanceUsd: customerBalanceUsd.toFixed(2),
  };
}

export const INVOICE_CANCEL_LEDGER_LABEL = "ביטול חשבונית באישור מנהל";

/** תיקון ממוקד: עמלה שנשארה OPEN אחרי ביטול קליטה — לא מוחקת רשומות. */
export async function reverseOpenCommissionFeesForCancelledCapture(params: {
  customerId: string;
  paymentCode: string;
  actorUserId: string;
  reason?: string | null;
}): Promise<{ feeIds: string[]; reversedUsd: number }> {
  const cid = params.customerId.trim();
  const code = params.paymentCode.trim();
  if (!cid || !code) return { feeIds: [], reversedUsd: 0 };

  const batch = await prisma.payment.findMany({
    where: { customerId: cid, paymentCode: code },
    select: { id: true, paymentNumber: true, status: true },
  });
  if (batch.length === 0) return { feeIds: [], reversedUsd: 0 };
  const number = batch[0]?.paymentNumber;
  const siblings =
    number != null
      ? await prisma.payment.findMany({
          where: { customerId: cid, paymentNumber: number },
          select: { id: true, status: true },
        })
      : batch;
  if (!siblings.every((p) => p.status === PAYMENT_RECORD_STATUS_CANCELLED)) {
    return { feeIds: [], reversedUsd: 0 };
  }

  const fees = await prisma.paymentAdjustmentFee.findMany({
    where: linkedCommissionFeeWhere({
      customerId: cid,
      paymentIds: siblings.map((p) => p.id),
      paymentCaptureCode: code,
    }),
    select: { id: true, amountUsd: true },
  });
  if (fees.length === 0) return { feeIds: [], reversedUsd: 0 };

  const now = new Date();
  const feeIds = fees.map((f) => f.id);
  const reversedUsd = fees.reduce((s, f) => s + Number(f.amountUsd ?? 0), 0);
  await prisma.$transaction(async (tx) => {
    await tx.paymentAdjustmentFee.updateMany({
      where: { id: { in: feeIds } },
      data: { status: "CANCELLED" },
    });
    await tx.auditLog.create({
      data: {
        userId: params.actorUserId,
        actionType: "PaymentCancelled",
        entityType: "PaymentAdjustmentFee",
        entityId: feeIds[0] ?? code,
        oldValue: { status: "OPEN", feeIds, amountsUsd: fees.map((f) => Number(f.amountUsd)) } as Prisma.InputJsonValue,
        newValue: { status: "CANCELLED", reversedUsd } as Prisma.InputJsonValue,
        metadata: {
          customerId: cid,
          paymentCode: code,
          reason: params.reason ?? "ביטול עמלה נלווית לתשלום מבוטל",
          reversedFeeIds: feeIds,
          reversedFeeUsd: reversedUsd,
          source: "CANCELLED_PAYMENT_FEE_REVERSAL",
          performedAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  });
  return { feeIds, reversedUsd };
}
