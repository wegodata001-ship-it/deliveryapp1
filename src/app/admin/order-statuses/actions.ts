"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  createOrderStatusTag,
  deleteOrderStatusTag,
  getOrderStatusUsageMapForManager,
  listOrderStatusTagsForManager,
  reorderOrderStatusTags,
  updateOrderStatusTag,
  type OrderStatusTag,
} from "@/lib/order-status-registry";
import { displayStatusCode } from "@/lib/order-status-shared";
import { invalidateOrderStatusDataCaches } from "@/lib/order-status-registry-cache";
import { statusesPerfEnd, statusesPerfLog, statusesPerfStart } from "@/lib/statuses-source-perf";

export type OrderStatusManagerRow = OrderStatusTag & { usageCount: number; code: string };

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
}

export async function listOrderStatusesManagerAction(search = ""): Promise<OrderStatusManagerRow[]> {
  statusesPerfStart("statuses.total");
  try {
    statusesPerfStart("statuses.auth");
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
    statusesPerfEnd("statuses.auth");

    const q = search.trim().toLowerCase();

    const [rows, usage] = await Promise.all([
      listOrderStatusTagsForManager(),
      getOrderStatusUsageMapForManager(),
    ]);

    statusesPerfStart("statuses.map");
    const mapped: OrderStatusManagerRow[] = rows.map((r) => ({
      ...r,
      code: displayStatusCode(r.id),
      usageCount: usage[r.id] ?? 0,
    }));
    const result = !q
      ? mapped
      : mapped.filter(
          (r) =>
            r.nameHe.toLowerCase().includes(q) ||
            r.code.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q) ||
            r.colorHex.toLowerCase().includes(q) ||
            (r.isActive ? "פעיל" : "לא פעיל").includes(q),
        );
    statusesPerfEnd("statuses.map");

    statusesPerfStart("statuses.serialize");
    JSON.stringify(result);
    statusesPerfEnd("statuses.serialize");

    statusesPerfLog("rows returned", {
      rowCount: result.length,
      tagCount: rows.length,
      filtered: q.length > 0,
      usageDistinct: Object.keys(usage).length,
    });

    return result;
  } finally {
    statusesPerfEnd("statuses.total");
  }
}

export async function createOrderStatusAction(input: {
  nameHe: string;
  colorHex: string;
  isActive?: boolean;
}) {
  await ensureAllowed();
  const res = await createOrderStatusTag(input);
  if (res.ok) revalidateStatusPaths();
  return res;
}

export async function updateOrderStatusAction(
  id: string,
  patch: { nameHe?: string; colorHex?: string; isActive?: boolean },
) {
  await ensureAllowed();
  const res = await updateOrderStatusTag(id, patch);
  if (res.ok) revalidateStatusPaths();
  return res;
}

export async function reorderOrderStatusesAction(ids: string[]) {
  await ensureAllowed();
  const res = await reorderOrderStatusTags(ids);
  if (res.ok) revalidateStatusPaths();
  return res;
}

export async function deleteOrderStatusAction(id: string, replaceWithId?: string) {
  await ensureAllowed();
  const res = await deleteOrderStatusTag(id, replaceWithId);
  if (res.ok) revalidateStatusPaths();
  return res;
}

function revalidateStatusPaths() {
  invalidateOrderStatusDataCaches();
  revalidatePath("/admin/source-tables/statuses");
  revalidatePath("/admin/orders");
}
