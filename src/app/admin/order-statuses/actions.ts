"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  createOrderStatusTag,
  deleteOrderStatusTag,
  listOrderStatusTags,
  reorderOrderStatusTags,
  updateOrderStatusTag,
  type OrderStatusTag,
} from "@/lib/order-status-registry";

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
}

export async function listOrderStatusesManagerAction(search = ""): Promise<OrderStatusTag[]> {
  await ensureAllowed();
  const rows = await listOrderStatusTags(true);
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.nameHe.toLowerCase().includes(q) ||
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
  revalidatePath("/admin");
}
