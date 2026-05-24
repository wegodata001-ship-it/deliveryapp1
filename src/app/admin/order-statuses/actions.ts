"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  createOrderStatusTag,
  deleteOrderStatusTag,
  displayStatusCode,
  getOrderStatusUsageMap,
  listOrderStatusTags,
  reorderOrderStatusTags,
  updateOrderStatusTag,
  type OrderStatusTag,
} from "@/lib/order-status-registry";

export type OrderStatusManagerRow = OrderStatusTag & { usageCount: number; code: string };

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
}

export async function listOrderStatusesManagerAction(search = ""): Promise<OrderStatusManagerRow[]> {
  await ensureAllowed();
  const [rows, usage] = await Promise.all([listOrderStatusTags(true), getOrderStatusUsageMap()]);
  const q = search.trim().toLowerCase();
  const mapped: OrderStatusManagerRow[] = rows.map((r) => ({
    ...r,
    code: displayStatusCode(r.id),
    usageCount: usage[r.id] ?? 0,
  }));
  if (!q) return mapped;
  return mapped.filter(
    (r) =>
      r.nameHe.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.colorHex.toLowerCase().includes(q) ||
      (r.isActive ? "פעיל" : "לא פעיל").includes(q),
  );
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
  revalidatePath("/admin/source-tables/statuses");
  revalidatePath("/admin/source-tables");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/capture");
  revalidatePath("/admin");
}
