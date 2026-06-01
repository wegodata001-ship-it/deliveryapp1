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
  statusesPerfStart("statuses.load");
  try {
    await ensureAllowed();
    const q = search.trim().toLowerCase();
    statusesPerfStart("statuses.filters");
    statusesPerfLog("filters applied", { searchLen: q.length, hasSearch: q.length > 0 });
    statusesPerfEnd("statuses.filters");

    const [rows, usage] = await Promise.all([
      listOrderStatusTagsForManager(),
      getOrderStatusUsageMapForManager(),
    ]);

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

    statusesPerfStart("statuses.response");
    statusesPerfLog("rows returned", {
      rowCount: result.length,
      tagCount: rows.length,
      filtered: q.length > 0,
      usageDistinct: Object.keys(usage).length,
    });
    statusesPerfEnd("statuses.response");

    return result;
  } finally {
    statusesPerfEnd("statuses.load");
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
