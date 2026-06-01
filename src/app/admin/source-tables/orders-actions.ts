"use server";

import { revalidatePath } from "next/cache";
import { clearExpiredOrderEditUnlockForOrder } from "@/app/admin/order-edit-requests/actions";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { canUserEditCompletedOrder } from "@/lib/order-edit-lock";
import {
  getOrderSourcePreview,
  getOrdersSourceKpisCached,
  listOrdersSourceForExport,
  listOrdersSourceTable,
  type OrdersSourceFilters,
  type OrdersSourceListQuery,
} from "@/lib/orders-source-table";
import { isValidOrderStatusId, resolveOrderStatusFromDisplayText } from "@/lib/order-status-registry";
import { prisma } from "@/lib/prisma";

async function ensureOrdersTableAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type OrdersSourceListPayload = Awaited<ReturnType<typeof listOrdersSourceTable>> & {
  kpis: Awaited<ReturnType<typeof getOrdersSourceKpisCached>>;
};

export async function listOrdersSourceTableAction(
  query: OrdersSourceListQuery & { search?: string },
): Promise<OrdersSourceListPayload> {
  await ensureOrdersTableAccess();
  const { search, ...rest } = query;
  const filters: OrdersSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  const [list, kpis] = await Promise.all([
    listOrdersSourceTable({ ...rest, filters }),
    getOrdersSourceKpisCached(),
  ]);
  return { ...list, kpis };
}

export async function getOrderSourcePreviewAction(
  orderId: string,
): Promise<Awaited<ReturnType<typeof getOrderSourcePreview>>> {
  await ensureOrdersTableAccess();
  return getOrderSourcePreview(orderId);
}

export async function updateOrderStatusSourceAction(
  orderId: string,
  statusInput: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await ensureOrdersTableAccess();
  const resolved = await resolveOrderStatusFromDisplayText(statusInput);
  const status = (resolved ?? statusInput?.trim()) || "";
  if (!status || !(await isValidOrderStatusId(status))) {
    return { ok: false, error: "סטטוס לא תקין" };
  }
  const oid = orderId.trim();
  if (!oid) return { ok: false, error: "מזהה הזמנה חסר" };

  await clearExpiredOrderEditUnlockForOrder(oid);
  const orderRow = await prisma.order.findFirst({
    where: { id: oid, deletedAt: null },
    select: { id: true, status: true, editUnlockedForUserId: true, editUnlockedUntil: true },
  });
  if (!orderRow) return { ok: false, error: "הזמנה לא נמצאה" };
  if (!isAdminUser(me) && !canUserEditCompletedOrder(me, orderRow)) {
    return { ok: false, error: "הזמנה בהושלמה נעולה — שינוי דורש אישור מנהל." };
  }
  await prisma.order.update({ where: { id: oid }, data: { status } });
  revalidatePath("/admin/orders");
  revalidatePath("/admin/source-tables/orders");
  return { ok: true };
}

export type OrdersExportKind = "excel" | "pdf";

export async function exportOrdersSourceAction(
  query: OrdersSourceListQuery & { search?: string },
  kind: OrdersExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensureOrdersTableAccess();
    const { search, ...rest } = query;
    const filters: OrdersSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const { page: _page, limit: _limit, ...exportQuery } = rest;
    const rows = await listOrdersSourceForExport({ ...exportQuery, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = [
      "מספר הזמנה",
      "שבוע",
      "לקוח",
      "מדינה",
      "תאריך",
      "דולר",
      "שקל",
      "תשלום",
      "סטטוס",
    ];
    const data = rows.map((r) => [
      r.orderNumber,
      r.weekCode,
      r.customerName,
      r.country,
      r.orderDateYmd,
      r.usd,
      r.ils,
      r.paymentLabel,
      r.statusLabel,
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`דוח הזמנות · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `orders_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `orders_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
