"use server";

import { ApprovalRequestStatus, ApprovalRequestType, Prisma, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { ensureApprovalRequestTablesOnce } from "@/lib/approval-request-bootstrap";
import { canApproveInvoiceCancel, canCancelInvoiceImmediately } from "@/lib/invoice-cancel-approve";
import { executePaymentCancellation } from "@/lib/payment-cancellation";
import { paymentUsdValue } from "@/lib/customer-balance";
import { prisma } from "@/lib/prisma";
import { PAYMENT_RECORD_STATUS_CANCELLED } from "@/lib/payment-record-status";
import { randomUUID } from "crypto";

async function notifyUsers(
  userIds: string[],
  title: string,
  body: string | null,
  kind: string,
  payload?: Prisma.InputJsonValue,
) {
  await ensureApprovalRequestTablesOnce();
  const base = { title, body, kind };
  for (const userId of userIds) {
    await prisma.userNotification.create({
      data: {
        userId,
        ...base,
        ...(payload !== undefined ? { payload } : {}),
      },
    });
  }
}

async function notifyInvoiceCancelApprovers(
  title: string,
  body: string | null,
  payload?: Prisma.InputJsonValue,
) {
  const approvers = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { role: "ADMIN" },
        {
          permissions: {
            some: {
              permission: { key: "invoice.cancel.approve", isActive: true },
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  await notifyUsers(
    approvers.map((u) => u.id),
    title,
    body,
    "INVOICE_CANCEL_REQUEST",
    payload,
  );
}

export type PaymentCancelRequestHint =
  | { status: "none" }
  | { status: "PENDING"; requestId: string }
  | { status: "REJECTED"; requestId: string };

export async function getPaymentCancelRequestHintAction(
  paymentId: string,
): Promise<PaymentCancelRequestHint> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) return { status: "none" };

  const pid = paymentId.trim();
  if (!pid) return { status: "none" };

  await ensureApprovalRequestTablesOnce();

  const latest = await prisma.approvalRequest.findFirst({
    where: {
      paymentId: pid,
      type: ApprovalRequestType.INVOICE_CANCEL,
      status: { in: [ApprovalRequestStatus.PENDING, ApprovalRequestStatus.REJECTED] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (!latest) return { status: "none" };
  if (latest.status === ApprovalRequestStatus.PENDING) {
    return { status: "PENDING", requestId: latest.id };
  }
  return { status: "REJECTED", requestId: latest.id };
}

export type CreateInvoiceCancelResult =
  | { ok: true; mode: "immediate" }
  | { ok: true; mode: "request"; requestId: string }
  | { ok: false; error: string };

/** בקשות ממנהלים עליונים — לא מוצגות (ביטול מיידי, ללא workflow) */
const employeeCancelRequestWhere = {
  type: ApprovalRequestType.INVOICE_CANCEL,
  requestedBy: { role: { not: UserRole.ADMIN } },
} as const;

export async function createInvoiceCancelRequestAction(input: {
  paymentId: string;
  cancelReason: string;
  notes?: string | null;
}): Promise<CreateInvoiceCancelResult> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments"])) {
    return { ok: false, error: "אין הרשאה" };
  }

  await ensureApprovalRequestTablesOnce();

  const pid = (input.paymentId || "").trim();
  const reason = (input.cancelReason || "").trim();
  const notes = (input.notes ?? "").trim() || null;

  if (!pid) return { ok: false, error: "חסר מזהה חשבונית" };
  if (reason.length < 3) return { ok: false, error: "יש להזין סיבת ביטול (לפחות 3 תווים)" };

  const payment = await prisma.payment.findFirst({
    where: { id: pid, customerId: { not: null } },
    select: {
      id: true,
      paymentCode: true,
      status: true,
      customer: { select: { displayName: true, customerCode: true } },
    },
  });
  if (!payment) return { ok: false, error: "חשבונית לא נמצאה" };
  if (payment.status === PAYMENT_RECORD_STATUS_CANCELLED) {
    return { ok: false, error: "החשבונית כבר מבוטלת" };
  }

  const combinedReason = [reason, notes].filter(Boolean).join(" — ") || reason;

  if (canCancelInvoiceImmediately(me)) {
    const now = new Date();
    await executePaymentCancellation({
      paymentId: pid,
      actorUserId: me.id,
      reason: combinedReason,
      directByAdmin: true,
    });

    await prisma.auditLog.create({
      data: {
        userId: me.id,
        actionType: "INVOICE_CANCELLED_IMMEDIATE",
        entityType: "Payment",
        entityId: pid,
        metadata: {
          paymentId: pid,
          paymentCode: payment.paymentCode,
          cancelReason: reason,
          notes,
          cancelledBy: me.fullName,
          cancelledAt: now.toISOString(),
          directByAdmin: true,
        } as Prisma.InputJsonValue,
      },
    });

    revalidatePath("/admin/source-tables/payments");
    revalidatePath("/admin/balances");
    return { ok: true, mode: "immediate" };
  }

  const pending = await prisma.approvalRequest.findFirst({
    where: {
      paymentId: pid,
      type: ApprovalRequestType.INVOICE_CANCEL,
      status: ApprovalRequestStatus.PENDING,
    },
    select: { id: true },
  });
  if (pending) return { ok: false, error: "כבר קיימת בקשת ביטול ממתינה לחשבונית זו" };

  const req = await prisma.approvalRequest.create({
    data: {
      id: randomUUID(),
      type: ApprovalRequestType.INVOICE_CANCEL,
      status: ApprovalRequestStatus.PENDING,
      paymentId: pid,
      requestedByUserId: me.id,
      cancelReason: reason,
      notes,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "INVOICE_CANCEL_REQUEST_CREATED",
      entityType: "ApprovalRequest",
      entityId: req.id,
      metadata: {
        paymentId: pid,
        paymentCode: payment.paymentCode,
        cancelReason: reason,
        notes,
        requestedBy: me.fullName,
      } as Prisma.InputJsonValue,
    },
  });

  const custLabel =
    payment.customer?.displayName?.trim() ||
    payment.customer?.customerCode?.trim() ||
    "לקוח";
  const timeHe = new Date().toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  await notifyInvoiceCancelApprovers(
    "בקשת ביטול חדשה",
    `חשבונית ${payment.paymentCode ?? pid} · ${custLabel} · ${me.fullName} · ${timeHe}`,
    { approvalRequestId: req.id, paymentId: pid } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/invoice-cancel-requests");
  revalidatePath("/admin/source-tables/payments");
  return { ok: true, mode: "request", requestId: req.id };
}

export type InvoiceCancelRequestRow = {
  id: string;
  paymentId: string;
  paymentCode: string | null;
  customerLabel: string | null;
  amountUsd: string;
  requestedByName: string;
  createdAtIso: string;
  cancelReason: string;
  notes: string | null;
  status: ApprovalRequestStatus;
};

export async function listInvoiceCancelRequestsAction(): Promise<InvoiceCancelRequestRow[]> {
  const me = await requireAuth();
  if (!canApproveInvoiceCancel(me)) return [];

  await ensureApprovalRequestTablesOnce();

  const rows = await prisma.approvalRequest.findMany({
    where: employeeCancelRequestWhere,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      payment: {
        select: {
          id: true,
          paymentCode: true,
          amountUsd: true,
          amountIls: true,
          customer: { select: { displayName: true, customerCode: true } },
        },
      },
      requestedBy: { select: { fullName: true, role: true } },
    },
  });

  return rows
    .filter((r) => !isAdminUser({ role: r.requestedBy.role }))
    .map((r) => {
    const payUsd = r.payment ? paymentUsdValue(r.payment) : 0;
    const customer = r.payment?.customer;
    const customerLabel =
      customer?.displayName?.trim() || customer?.customerCode?.trim() || null;
    return {
      id: r.id,
      paymentId: r.paymentId,
      paymentCode: r.payment?.paymentCode ?? null,
      customerLabel,
      amountUsd: payUsd.toFixed(2),
      requestedByName: r.requestedBy.fullName,
      createdAtIso: r.createdAt.toISOString(),
      cancelReason: r.cancelReason,
      notes: r.notes,
      status: r.status,
    };
  });
}

export async function countPendingInvoiceCancelRequestsAction(): Promise<number> {
  const me = await requireAuth();
  if (!canApproveInvoiceCancel(me)) return 0;
  await ensureApprovalRequestTablesOnce();
  return prisma.approvalRequest.count({
    where: {
      ...employeeCancelRequestWhere,
      status: ApprovalRequestStatus.PENDING,
    },
  });
}

export async function approveInvoiceCancelRequestAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canApproveInvoiceCancel(me)) {
    return { ok: false, error: "אין הרשאה לאישור ביטול חשבונית" };
  }

  await ensureApprovalRequestTablesOnce();

  const rid = requestId.trim();
  const req = await prisma.approvalRequest.findFirst({
    where: {
      id: rid,
      type: ApprovalRequestType.INVOICE_CANCEL,
      status: ApprovalRequestStatus.PENDING,
    },
    select: {
      id: true,
      paymentId: true,
      cancelReason: true,
      notes: true,
      requestedByUserId: true,
      payment: { select: { paymentCode: true, status: true } },
      requestedBy: { select: { fullName: true } },
    },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };
  if (req.payment?.status === PAYMENT_RECORD_STATUS_CANCELLED) {
    return { ok: false, error: "החשבונית כבר מבוטלת" };
  }

  const now = new Date();
  const combinedReason = [req.cancelReason, req.notes].filter(Boolean).join(" — ") || null;

  await prisma.approvalRequest.update({
    where: { id: req.id },
    data: {
      status: ApprovalRequestStatus.APPROVED,
      approvedAt: now,
      approvedByUserId: me.id,
    },
  });

  await executePaymentCancellation({
    paymentId: req.paymentId,
    actorUserId: me.id,
    reason: combinedReason,
    approvalRequestId: req.id,
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "INVOICE_CANCEL_REQUEST_APPROVED",
      entityType: "ApprovalRequest",
      entityId: req.id,
      metadata: {
        paymentId: req.paymentId,
        paymentCode: req.payment?.paymentCode,
        cancelReason: req.cancelReason,
        notes: req.notes,
        requestedBy: req.requestedBy.fullName,
        approvedAt: now.toISOString(),
        approvedBy: me.fullName,
      } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת ביטול חשבונית אושרה",
    `חשבונית ${req.payment?.paymentCode ?? req.paymentId} בוטלה`,
    "INVOICE_CANCEL_APPROVED",
    { paymentId: req.paymentId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/invoice-cancel-requests");
  revalidatePath("/admin/source-tables/payments");
  return { ok: true };
}

export async function rejectInvoiceCancelRequestAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!canApproveInvoiceCancel(me)) {
    return { ok: false, error: "אין הרשאה לדחיית בקשת ביטול" };
  }

  await ensureApprovalRequestTablesOnce();

  const rid = requestId.trim();
  const req = await prisma.approvalRequest.findFirst({
    where: {
      id: rid,
      type: ApprovalRequestType.INVOICE_CANCEL,
      status: ApprovalRequestStatus.PENDING,
    },
    select: {
      id: true,
      paymentId: true,
      requestedByUserId: true,
      cancelReason: true,
      payment: { select: { paymentCode: true } },
    },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };

  const now = new Date();
  await prisma.approvalRequest.update({
    where: { id: req.id },
    data: {
      status: ApprovalRequestStatus.REJECTED,
      rejectedAt: now,
      rejectedByUserId: me.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "INVOICE_CANCEL_REQUEST_REJECTED",
      entityType: "ApprovalRequest",
      entityId: req.id,
      metadata: {
        paymentId: req.paymentId,
        paymentCode: req.payment?.paymentCode,
        cancelReason: req.cancelReason,
        rejectedAt: now.toISOString(),
        rejectedBy: me.fullName,
      } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת ביטול חשבונית נדחתה",
    `חשבונית ${req.payment?.paymentCode ?? req.paymentId} נשארת פעילה`,
    "INVOICE_CANCEL_REJECTED",
    { paymentId: req.paymentId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/invoice-cancel-requests");
  return { ok: true };
}
