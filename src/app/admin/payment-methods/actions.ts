"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  createPaymentMethodTag,
  deletePaymentMethodTag,
  getPaymentMethodUsageMapForManager,
  listPaymentMethodTagsForManager,
  reorderPaymentMethodTags,
  updatePaymentMethodTag,
  type PaymentMethodTag,
} from "@/lib/payment-method-registry";
import { displayPaymentMethodCode } from "@/lib/payment-method-slugs";
import { invalidatePaymentMethodDataCaches } from "@/lib/payment-method-registry-cache";

export type PaymentMethodManagerRow = PaymentMethodTag & { usageCount: number; code: string };

async function ensureAllowed() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) throw new Error("אין הרשאה");
}

function revalidatePaymentMethodSurfaces() {
  invalidatePaymentMethodDataCaches();
  revalidatePath("/admin/source-tables/payment-methods");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/payments");
}

export async function listPaymentMethodsManagerAction(search = ""): Promise<PaymentMethodManagerRow[]> {
  await ensureAllowed();
  const q = search.trim().toLowerCase();
  const [rows, usage] = await Promise.all([
    listPaymentMethodTagsForManager(),
    getPaymentMethodUsageMapForManager(),
  ]);
  const mapped: PaymentMethodManagerRow[] = rows.map((r) => ({
    ...r,
    code: displayPaymentMethodCode(r.id),
    usageCount: usage[r.id] ?? 0,
  }));
  if (!q) return mapped;
  return mapped.filter(
    (r) =>
      r.nameHe.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.nameEn ?? "").toLowerCase().includes(q) ||
      (r.isActive ? "פעיל" : "לא פעיל").includes(q),
  );
}

export async function createPaymentMethodAction(input: {
  nameHe: string;
  nameAr?: string;
  nameEn?: string;
  colorHex: string;
  icon?: string;
  isActive?: boolean;
}) {
  await ensureAllowed();
  const res = await createPaymentMethodTag(input);
  if (res.ok) revalidatePaymentMethodSurfaces();
  return res;
}

export async function updatePaymentMethodAction(
  id: string,
  patch: {
    nameHe?: string;
    nameAr?: string | null;
    nameEn?: string | null;
    colorHex?: string;
    icon?: string | null;
    isActive?: boolean;
  },
) {
  await ensureAllowed();
  const res = await updatePaymentMethodTag(id, patch);
  if (res.ok) revalidatePaymentMethodSurfaces();
  return res;
}

export async function reorderPaymentMethodsAction(ids: string[]) {
  await ensureAllowed();
  const res = await reorderPaymentMethodTags(ids);
  if (res.ok) revalidatePaymentMethodSurfaces();
  return res;
}

export async function deletePaymentMethodAction(id: string, replaceWithId?: string) {
  await ensureAllowed();
  const res = await deletePaymentMethodTag(id, replaceWithId);
  if (res.ok) revalidatePaymentMethodSurfaces();
  return res;
}
