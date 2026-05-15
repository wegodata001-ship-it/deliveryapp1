"use server";

import { OrderEditRequestStatus, OrderStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import {
  ORDER_EDIT_UNLOCK_DURATION_MS,
  canUserEditCompletedOrder,
  orderSensitiveStatusHe,
  orderStatusRequiresEditApproval,
} from "@/lib/order-edit-lock";

async function ensureOrderEditRequestTables(): Promise<void> {
  await ensureOnce("order-edit-request-tables", async () => {
    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderEditRequestStatus') THEN
          CREATE TYPE "OrderEditRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'USED');
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'OrderEditRequestStatus' AND e.enumlabel = 'USED'
        ) THEN
          ALTER TYPE "OrderEditRequestStatus" ADD VALUE 'USED';
        END IF;
      END
      $$;
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "OrderEditRequest" (
        "id" TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "requestedByUserId" TEXT NOT NULL,
        "requestReason" TEXT NOT NULL,
        "status" "OrderEditRequestStatus" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "approvedAt" TIMESTAMP(3),
        "approvedByUserId" TEXT,
        "rejectedAt" TIMESTAMP(3),
        "rejectedByUserId" TEXT
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_orderId_idx" ON "OrderEditRequest" ("orderId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_status_idx" ON "OrderEditRequest" ("status")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_requestedByUserId_idx" ON "OrderEditRequest" ("requestedByUserId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OrderEditRequest_createdAt_idx" ON "OrderEditRequest" ("createdAt")`;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "UserNotification" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT,
        "payload" JSONB,
        "readAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "UserNotification_userId_createdAt_idx" ON "UserNotification" ("userId", "createdAt")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx" ON "UserNotification" ("userId", "readAt")`;
  });
}

async function notifyUsers(userIds: string[], title: string, body: string | null, kind: string, payload?: Prisma.InputJsonValue) {
  await ensureOrderEditRequestTables();
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
      status: OrderStatus;
    };

/**
 * לפני פתיחת UI עריכת הזמנה — קובע האם עובד צריך מודל נעילה במקום לפתוח את הטופס.
 * אדמינים תמיד `direct`.
 */
export async function getOrderEditEntryHintAction(orderId: string): Promise<OrderEditEntryHint> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) return { kind: "direct" };

  const oid = orderId.trim();
  if (!oid) return { kind: "direct" };

  await ensureOrderEditRequestTables();
  await clearExpiredOrderEditUnlockForOrder(oid);

  const order = await prisma.order.findFirst({
    where: { id: oid, deletedAt: null },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      editUnlockedForUserId: true,
      editUnlockedUntil: true,
    },
  });
  if (!order) return { kind: "direct" };

  if (isAdminUser(me)) return { kind: "direct" };
  if (!orderStatusRequiresEditApproval(order.status)) return { kind: "direct" };

  const gate = {
    status: order.status,
    editUnlockedForUserId: order.editUnlockedForUserId,
    editUnlockedUntil: order.editUnlockedUntil,
  };
  if (canUserEditCompletedOrder(me, gate)) return { kind: "direct" };

  const pending = await prisma.orderEditRequest.findFirst({
    where: { orderId: oid, status: OrderEditRequestStatus.PENDING },
    select: { requestedByUserId: true },
  });
  if (pending) {
    return {
      kind: "prelock",
      variant: pending.requestedByUserId === me.id ? "pending_mine" : "pending_other",
      orderId: oid,
      orderNumber: order.orderNumber,
      status: order.status,
    };
  }

  const latest = await prisma.orderEditRequest.findFirst({
    where: { orderId: oid },
    orderBy: { createdAt: "desc" },
    select: { status: true, requestedByUserId: true },
  });
  if (latest?.status === OrderEditRequestStatus.REJECTED && latest.requestedByUserId === me.id) {
    return {
      kind: "prelock",
      variant: "rejected",
      orderId: oid,
      orderNumber: order.orderNumber,
      status: order.status,
    };
  }

  return {
    kind: "prelock",
    variant: "locked",
    orderId: oid,
    orderNumber: order.orderNumber,
    status: order.status,
  };
}

export async function createOrderEditRequestAction(orderId: string, requestReason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["edit_orders"])) return { ok: false, error: "אין הרשאה" };
  if (isAdminUser(me)) return { ok: false, error: "מנהלים יכולים לערוך ישירות — לא נדרשת בקשה" };
  await ensureOrderEditRequestTables();

  const oid = orderId.trim();
  const reason = requestReason.trim();
  if (!oid) return { ok: false, error: "חסר מזהה הזמנה" };
  if (!reason || reason.length < 3) return { ok: false, error: "יש להזין סיבת עריכה (לפחות 3 תווים)" };

  const order = await prisma.order.findFirst({
    where: { id: oid, deletedAt: null },
    select: { id: true, status: true, orderNumber: true },
  });
  if (!order) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!orderStatusRequiresEditApproval(order.status)) {
    return { ok: false, error: "בקשת אישור נדרשת רק להזמנה במצב ״מוכן״ (הושלמה) או ״מבוטל״" };
  }

  const pending = await prisma.orderEditRequest.findFirst({
    where: { orderId: oid, status: OrderEditRequestStatus.PENDING },
    select: { id: true },
  });
  if (pending) return { ok: false, error: "כבר קיימת בקשה ממתינה להזמנה זו" };

  const req = await prisma.orderEditRequest.create({
    data: {
      orderId: oid,
      requestedByUserId: me.id,
      requestReason: reason,
      status: OrderEditRequestStatus.PENDING,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_EDIT_REQUEST_CREATED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: { orderId: oid, orderNumber: order.orderNumber, requestReason: reason } as Prisma.InputJsonValue,
    },
  });

  const statusHe = orderSensitiveStatusHe(order.status);
  const timeHe = new Date().toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  await notifyAllAdmins(
    "בקשת עריכת הזמנה",
    `הזמנה ${order.orderNumber ?? oid} (${statusHe}) — ${me.fullName} — ${timeHe}`,
    "ORDER_EDIT_REQUEST",
    { orderEditRequestId: req.id, orderId: oid } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true };
}

export type OrderEditRequestRow = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  customerLabel: string | null;
  /** סטטוס ההזמנה ב־DB (מוכן / מבוטל וכו׳) */
  orderStatus: OrderStatus;
  requestedByName: string;
  createdAtIso: string;
  requestReason: string;
  status: OrderEditRequestStatus;
};

export async function countPendingOrderEditRequestsForAdmin(): Promise<number> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return 0;
  await ensureOrderEditRequestTables();
  return prisma.orderEditRequest.count({ where: { status: OrderEditRequestStatus.PENDING } });
}

export async function listOrderEditRequestsAction(): Promise<OrderEditRequestRow[]> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return [];
  await ensureOrderEditRequestTables();

  const rows = await prisma.orderEditRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      order: { select: { orderNumber: true, customerNameSnapshot: true, status: true } },
      requestedBy: { select: { fullName: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order.orderNumber,
    customerLabel: r.order.customerNameSnapshot,
    orderStatus: r.order.status,
    requestedByName: r.requestedBy.fullName,
    createdAtIso: r.createdAt.toISOString(),
    requestReason: r.requestReason,
    status: r.status,
  }));
}

export async function approveOrderEditRequestAction(
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "אין הרשאה — מנהלים בלבד" };
  await ensureOrderEditRequestTables();

  const rid = requestId.trim();
  const req = await prisma.orderEditRequest.findFirst({
    where: { id: rid, status: OrderEditRequestStatus.PENDING },
    select: { id: true, orderId: true, requestedByUserId: true, requestReason: true },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };

  const until = new Date(Date.now() + ORDER_EDIT_UNLOCK_DURATION_MS);

  await prisma.$transaction([
    prisma.orderEditRequest.updateMany({
      where: {
        orderId: req.orderId,
        status: OrderEditRequestStatus.APPROVED,
        id: { not: req.id },
      },
      data: { status: OrderEditRequestStatus.USED },
    }),
    prisma.orderEditRequest.update({
      where: { id: req.id },
      data: {
        status: OrderEditRequestStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: me.id,
      },
    }),
    prisma.order.update({
      where: { id: req.orderId },
      data: {
        editUnlockedForUserId: req.requestedByUserId,
        editUnlockedUntil: until,
      },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_EDIT_REQUEST_APPROVED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: {
        orderId: req.orderId,
        unlockedUntil: until.toISOString(),
        requestReason: req.requestReason,
      } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת עריכת הזמנה אושרה",
    `קיבלת הרשאת עריכה זמנית עד ${until.toLocaleString("he-IL")}`,
    "ORDER_EDIT_APPROVED",
    { orderId: req.orderId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true };
}

export async function rejectOrderEditRequestAction(requestId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAuth();
  if (!isAdminUser(me)) return { ok: false, error: "אין הרשאה — מנהלים בלבד" };
  await ensureOrderEditRequestTables();

  const rid = requestId.trim();
  const req = await prisma.orderEditRequest.findFirst({
    where: { id: rid, status: OrderEditRequestStatus.PENDING },
    select: { id: true, orderId: true, requestedByUserId: true, requestReason: true },
  });
  if (!req) return { ok: false, error: "בקשה לא נמצאה או שכבר טופלה" };

  await prisma.orderEditRequest.update({
    where: { id: req.id },
    data: {
      status: OrderEditRequestStatus.REJECTED,
      rejectedAt: new Date(),
      rejectedByUserId: me.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      actionType: "ORDER_EDIT_REQUEST_REJECTED",
      entityType: "OrderEditRequest",
      entityId: req.id,
      metadata: { orderId: req.orderId, requestReason: req.requestReason } as Prisma.InputJsonValue,
    },
  });

  await notifyUsers(
    [req.requestedByUserId],
    "בקשת עריכת הזמנה נדחתה",
    "פנה למנהל לפרטים נוספים.",
    "ORDER_EDIT_REJECTED",
    { orderId: req.orderId } as Prisma.InputJsonValue,
  );

  revalidatePath("/admin/orders");
  revalidatePath("/admin/order-edit-requests");
  return { ok: true };
}

export async function listUnreadNotificationsAction(): Promise<{ id: string; title: string; body: string | null; createdAtIso: string }[]> {
  const me = await requireAuth();
  await ensureOrderEditRequestTables();
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
  await ensureOrderEditRequestTables();
  const clean = ids.map((x) => x.trim()).filter(Boolean);
  if (clean.length === 0) return;
  await prisma.userNotification.updateMany({
    where: { userId: me.id, id: { in: clean }, readAt: null },
    data: { readAt: new Date() },
  });
}

/**
 * לאחר שמירת עריכה מוצלחת — מסמן את אישור העריכה האחרון (אם קיים) כנוצל,
 * ומנקה תמיד את שדות פתיחת הנעילה בהזמנה.
 *
 * שיפור ביצועים: רוב השמירות הן של הזמנות רגילות ללא APPROVED edit-request
 * וללא unlock פעיל — במקרים אלו אנחנו יוצאים מוקדם ללא עבודה.
 */
export async function markApprovedEditRequestUsedAndClearUnlock(orderId: string, editorUserId: string): Promise<void> {
  const oid = orderId.trim();
  if (!oid) return;

  await ensureOrderEditRequestTables();

  // קריאה מקבילית: גם ה-APPROVED האחרון, גם מצב הנעילה של ההזמנה.
  const [latest, orderState] = await Promise.all([
    prisma.orderEditRequest.findFirst({
      where: { orderId: oid, status: OrderEditRequestStatus.APPROVED },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    }),
    prisma.order.findFirst({
      where: { id: oid },
      select: { editUnlockedForUserId: true, editUnlockedUntil: true },
    }),
  ]);

  const hasUnlock = Boolean(orderState?.editUnlockedForUserId || orderState?.editUnlockedUntil);
  // Short-circuit: אין מה לעדכן ואין מה לסמן כנוצל.
  if (!latest && !hasUnlock) return;

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (latest) {
    ops.push(
      prisma.orderEditRequest.update({
        where: { id: latest.id },
        data: { status: OrderEditRequestStatus.USED },
      }),
    );
  }
  if (hasUnlock) {
    ops.push(
      prisma.order.update({
        where: { id: oid },
        data: { editUnlockedForUserId: null, editUnlockedUntil: null },
      }),
    );
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  if (latest) {
    await prisma.auditLog.create({
      data: {
        userId: editorUserId,
        actionType: "ORDER_EDIT_REQUEST_USED",
        entityType: "OrderEditRequest",
        entityId: latest.id,
        metadata: { orderId: oid } as Prisma.InputJsonValue,
      },
    });
  }
}
