"use server";

import { unstable_noStore as noStore } from "next/cache";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { fetchOrdersListPageData } from "@/lib/orders-list-data";
import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser } from "@/lib/admin-auth";
import { ensureOrderCompletionColumnOnce } from "@/lib/order-completion";
import { OS } from "@/lib/order-status-slugs";
import { prisma } from "@/lib/prisma";

/** רענון רשימת הזמנות לפי פרמטרי URL נוכחיים — ללא שינוי פילטרים */
export async function refreshOrdersListAction(
  sp: Record<string, string | string[] | undefined>,
) {
  noStore();
  const me = await requireRoutePermission(["view_orders"]);
  return fetchOrdersListPageData(sp, me, { bypassCache: true, refreshStats: true });
}

export async function updateOrderCompletedFlagAction(
  orderId: string,
  isCompleted: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  noStore();
  const me = await requireRoutePermission(["edit_orders"]);
  if (!isAdminUser(me)) {
    return { ok: false, error: "אין הרשאה לשינוי שדה הושלם" };
  }

  await ensureOrderCompletionColumnOnce();
  const id = orderId.trim();
  if (!id) return { ok: false, error: "חסר מזהה הזמנה" };

  const row = await prisma.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, orderNumber: true, status: true, isCompleted: true },
  });
  if (!row) return { ok: false, error: "הזמנה לא נמצאה" };
  if (row.status !== OS.COMPLETED) {
    return { ok: false, error: "אפשר לסמן הושלם רק להזמנה במצב מוכן" };
  }
  if (row.isCompleted === isCompleted) return { ok: true };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: { isCompleted },
    });
    await tx.auditLog.create({
      data: {
        userId: me.id,
        actionType: isCompleted ? "ORDER_OPERATION_COMPLETED" : "ORDER_OPERATION_REOPENED",
        entityType: "Order",
        entityId: id,
        oldValue: { isCompleted: row.isCompleted } as Prisma.InputJsonValue,
        newValue: { isCompleted } as Prisma.InputJsonValue,
        metadata: {
          orderId: id,
          orderNumber: row.orderNumber,
          status: row.status,
          updatedBy: me.fullName,
        } as Prisma.InputJsonValue,
      },
    });
  });

  const { invalidateOrdersListDataCache } = await import("@/lib/orders-list-data");
  invalidateOrdersListDataCache();
  revalidatePath("/admin/orders");
  return { ok: true };
}
