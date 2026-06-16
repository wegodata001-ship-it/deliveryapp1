"use server";

import { OrderEditRequestStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ensureOrderEditRequestTablesOnce } from "@/lib/order-edit-request-bootstrap";
import { getPendingOrderEditRequestCount } from "@/lib/admin-layout-cache";
import {
  computeOrderEditDiff,
  parseOrderEditSnapshot,
  type OrderEditDiffRow,
} from "@/lib/order-edit-snapshot";

async function notifyUsers(userIds: string[], title: string, body: string | null, kind: string, payload?: Prisma.InputJsonValue) {
  await ensureOrderEditRequestTablesOnce();
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

async function notifyAllAdmins(title: string, body: string | null, kind: string, payload?: Prisma.InputJsonValue) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  await notifyUsers(
    admins.map((a) => a.id),
    title,
    body,
    kind,
    payload,
  );
}

/** ניקוי נעילה שפגה — לפני בדיקת הרשאות */
export async function clearExpiredOrderEditUnlockForOrder(orderId: string): Promise<void> {
  await prisma.order.updateMany({
    where: {
      id: orderId,
      editUnlockedUntil: { not: null, lt: new Date() },
    },
    data: {
      editUnlockedForUserId: null,
      editUnlockedUntil: null,
    },
  });
}

export type OrderEditEntryHint =
  | { kind: "direct" }
  | {
      kind: "prelock";
      variant: "locked" | "rejected" | "pending_mine" | "pending_other";
      orderId: string;
      orderNumber: string | null;
      status: string;
    };

/**
 * לפני פתיחת UI עריכת הזמנה — תמיד פותחים את הטופס.
 * עובדים שולחים בקשת עדכון בעת שמירה (לא לפני).
 */
export async function getOrderEditEntryHintAction(_orderId: string): Promise<OrderEditEntryHint> {
  await requireAuth();
  return { kind: "direct" };
}

/** @deprecated — השתמשו בשמירה עם סיבת עדכון מתוך טופס ההזמנה */
export async function createOrderEditRequestAction(orderId: string, requestReason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  void orderId;
  void requestReason;
  return {
    ok: false,
    error: "בצעו את השינוי בטופס ההזמנה ולחצו «שליחה לאישור» עם סיבת העדכון.",
  };
}

export type OrderEditRequestRow = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  customerLabel: string | null;
  orderStatus: string;
  requestedByName: string;
  createdAtIso: string;
  requestReason: string;
  status: OrderEditRequestStatus;
  diff: OrderEditDiffRow[];
  approvedByName: string | null;
  approvedAtIso: string | null;
  rejectedByName: string | null;
  rejectedAtIso: string | null;
  rejectionReason: string | null;
};

export async function countPendingOrderEditRequestsForAdmin(): Promise<number> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return 0;
  return getPendingOrderEditRequestCount();
}

export async function listOrderEditRequestsAction(): Promise<OrderEditRequestRow[]> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return [];
  await ensureOrderEditRequestTablesOnce();

  const rows = await prisma.orderEditRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      order: { select: { orderNumber: true, customerNameSnapshot: true, status: true } },
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      rejectedBy: { select: { fullName: true } },
    },
  });

  const snapshotRows =
    rows.length > 0
      ? await prisma.$queryRaw<
          Array<{ id: string; beforeSnapshot: unknown; afterSnapshot: unknown; rejectionReason: string | null }>
        >`
          SELECT "id", "beforeSnapshot", "afterSnapshot", "rejectionReason"
          FROM "OrderEditRequest"
          WHERE "id" IN (${Prisma.join(rows.map((r) => r.id))})
        `
      : [];
  const snapshotById = new Map(snapshotRows.map((s) => [s.id, s]));

  return rows.map((r) => {
    const snap = snapshotById.get(r.id);
    return {
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.order.orderNumber,
      customerLabel: r.order.customerNameSnapshot,
      orderStatus: r.order.status,
      requestedByName: r.requestedBy.fullName,
      createdAtIso: r.createdAt.toISOString(),
      requestReason: r.requestReason,
      status: r.status,
      diff: computeOrderEditDiff(
        parseOrderEditSnapshot(snap?.beforeSnapshot),
        parseOrderEditSnapshot(snap?.afterSnapshot),
      ),
      approvedByName: r.approvedBy?.fullName ?? null,
      approvedAtIso: r.approvedAt?.toISOString() ?? null,
      rejectedByName: r.rejectedBy?.fullName ?? null,
      rejectedAtIso: r.rejectedAt?.toISOString() ?? null,
      rejectionReason: snap?.rejectionReason ?? null,
    };
  });
}

export async function approveOrderEditRequestAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "אין הרשאה — מנהלים בלבד" };
  await ensureOrderEditRequestTablesOnce();

  const rid = requestId.trim();
  const req = await prisma.orderEditRequest.findFirst({
    where: { id: rid, status: OrderEditRequestStatus.PENDING },
    select: {
      id: true,
      orderId: true,
      requestedByUserId: true,
      requestReason: true,
      order: { select: { orderNumber: true } },
    },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };

  const reqFull = await prisma.$queryRaw<
    Array<{
      beforeSnapshot: unknown;
      afterSnapshot: unknown;
      proposedPayload: unknown;
    }>
  >`
    SELECT "beforeSnapshot", "afterSnapshot", "proposedPayload"
    FROM "OrderEditRequest"
    WHERE "id" = ${rid}
    LIMIT 1
  `;
  const snapshots = reqFull[0];
  if (!snapshots?.proposedPayload || typeof snapshots.proposedPayload !== "object") {
    return { ok: false, error: "בקשה ישנה ללא נתוני עדכון — דחו ובקשו מהעובד לשלוח מחדש" };
  }

  const { updateOrderWorkPanelAction } = await import("@/app/admin/capture/actions");
  const applyResult = await updateOrderWorkPanelAction(
    snapshots.proposedPayload as Parameters<typeof updateOrderWorkPanelAction>[0],
    { orderEditRequestId: req.id },
  );
  if (!applyResult.ok) return { ok: false, error: applyResult.error };

  const diff = computeOrderEditDiff(
    parseOrderEditSnapshot(snapshots.beforeSnapshot),
    parseOrderEditSnapshot(snapshots.afterSnapshot),
  );

  await prisma.orderEditRequest.update({
    where: { id: req.id },
    data: {
      status: OrderEditRequestStatus.APPROVED,
      approvedAt: new Date(),
      approvedByUserId: me.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_UPDATE_REQUEST_APPROVED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: {
        orderId: req.orderId,
        orderNumber: req.order.orderNumber,
        requestReason: req.requestReason,
        approvedBy: me.fullName,
        diff: diff as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת עדכון הזמנה אושרה",
    `השינויים להזמנה ${req.order.orderNumber ?? req.orderId} יושמו במערכת.`,
    "ORDER_UPDATE_APPROVED",
    { orderId: req.orderId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true };
}

export async function rejectOrderEditRequestAction(
  requestId: string,
  rejectionReason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "אין הרשאה — מנהלים בלבד" };
  await ensureOrderEditRequestTablesOnce();

  const rid = requestId.trim();
  const reason = (rejectionReason ?? "").trim() || null;
  const req = await prisma.orderEditRequest.findFirst({
    where: { id: rid, status: OrderEditRequestStatus.PENDING },
    select: {
      id: true,
      orderId: true,
      requestedByUserId: true,
      requestReason: true,
      order: { select: { orderNumber: true } },
    },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };

  const reqFull = await prisma.$queryRaw<
    Array<{ beforeSnapshot: unknown; afterSnapshot: unknown }>
  >`
    SELECT "beforeSnapshot", "afterSnapshot"
    FROM "OrderEditRequest"
    WHERE "id" = ${rid}
    LIMIT 1
  `;
  const snapshots = reqFull[0];

  const diff = computeOrderEditDiff(
    parseOrderEditSnapshot(snapshots?.beforeSnapshot),
    parseOrderEditSnapshot(snapshots?.afterSnapshot),
  );

  await prisma.$executeRaw`
    UPDATE "OrderEditRequest"
    SET
      "status" = 'REJECTED'::"OrderEditRequestStatus",
      "rejectedAt" = ${new Date()},
      "rejectedByUserId" = ${me.id},
      "rejectionReason" = ${reason}
    WHERE "id" = ${rid}
  `;

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_UPDATE_REQUEST_REJECTED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: {
        orderId: req.orderId,
        orderNumber: req.order.orderNumber,
        requestReason: req.requestReason,
        rejectionReason: reason,
        rejectedBy: me.fullName,
        diff: diff as unknown as Prisma.InputJsonValue,
      } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת עדכון הזמנה נדחתה",
    reason ?? "פנה למנהל לפרטים נוספים.",
    "ORDER_UPDATE_REJECTED",
    { orderId: req.orderId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true };
}

export async function listUnreadNotificationsAction(): Promise<{ id: string; title: string; body: string | null; createdAtIso: string }[]> {
  const me = await requireAuth();
  await ensureOrderEditRequestTablesOnce();
  const rows = await prisma.userNotification.findMany({
    where: { userId: me.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, body: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAtIso: r.createdAt.toISOString(),
  }));
}

export async function markNotificationsReadAction(ids: string[]): Promise<void> {
  const me = await requireAuth();
  await ensureOrderEditRequestTablesOnce();
  const clean = ids.map((x) => x.trim()).filter(Boolean);
  if (clean.length === 0) return;
  await prisma.userNotification.updateMany({
    where: { userId: me.id, id: { in: clean }, readAt: null },
    data: { readAt: new Date() },
  });
}

/** @deprecated — זרימת unlock הוחלפה בבקשת עדכון עם snapshot */
export async function markApprovedEditRequestUsedAndClearUnlock(orderId: string, editorUserId: string): Promise<void> {
  void editorUserId;
  const oid = orderId.trim();
  if (!oid) return;
  await ensureOrderEditRequestTablesOnce();
  await prisma.order.updateMany({
    where: { id: oid, editUnlockedUntil: { not: null } },
    data: { editUnlockedForUserId: null, editUnlockedUntil: null },
  });
}
