"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  ensurePaymentMethodsTable,
  getPaymentMethodSourcePreview,
  listPaymentMethodsSourceForExport,
  loadPaymentMethodsWithKpis,
  type PaymentMethodsSourceFilters,
  type PaymentMethodsSourceListQuery,
} from "@/lib/payment-methods-source-table";

async function ensureAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type PaymentMethodsSourceListPayload = Awaited<ReturnType<typeof loadPaymentMethodsWithKpis>>;

export async function listPaymentMethodsSourceTableAction(
  query: PaymentMethodsSourceListQuery & { search?: string },
): Promise<PaymentMethodsSourceListPayload> {
  await ensureAccess();
  const { search, ...rest } = query;
  const filters: PaymentMethodsSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  return loadPaymentMethodsWithKpis({ ...rest, filters });
}

export async function getPaymentMethodSourcePreviewAction(
  methodId: string,
): Promise<Awaited<ReturnType<typeof getPaymentMethodSourcePreview>>> {
  await ensureAccess();
  return getPaymentMethodSourcePreview(methodId);
}

export async function updatePaymentMethodSourceAction(
  methodId: string,
  nameHe: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureAccess();
  await ensurePaymentMethodsTable();
  const id = methodId.trim();
  const name = nameHe.trim();
  if (!id) return { ok: false, error: "מזהה חסר" };
  if (!name) return { ok: false, error: "שם נדרש" };

  await prisma.$executeRaw`
    INSERT INTO "SourcePaymentMethod" ("id", "nameHe", "isActive", "updatedAt")
    VALUES (${id}, ${name}, ${isActive}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "nameHe" = EXCLUDED."nameHe",
      "isActive" = EXCLUDED."isActive",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  revalidatePath("/admin/source-tables/payment-methods");
  return { ok: true };
}

export async function togglePaymentMethodActiveAction(
  methodId: string,
): Promise<{ ok: true; isActive: boolean } | { ok: false; error: string }> {
  await ensureAccess();
  await ensurePaymentMethodsTable();
  const id = methodId.trim();
  if (!id) return { ok: false, error: "לא נמצא" };

  const rows = await prisma.$queryRaw<Array<{ isActive: boolean }>>`
    SELECT "isActive" FROM "SourcePaymentMethod" WHERE "id" = ${id} LIMIT 1
  `;
  const cur = rows[0];
  if (!cur) return { ok: false, error: "אמצעי תשלום לא נמצא" };

  const next = !cur.isActive;
  await prisma.$executeRaw`
    UPDATE "SourcePaymentMethod"
    SET "isActive" = ${next}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
  `;
  revalidatePath("/admin/source-tables/payment-methods");
  return { ok: true, isActive: next };
}

export type PaymentMethodsExportKind = "excel" | "pdf";

export async function exportPaymentMethodsSourceAction(
  query: PaymentMethodsSourceListQuery & { search?: string },
  kind: PaymentMethodsExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensureAccess();
    const { search, ...rest } = query;
    const filters: PaymentMethodsSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const rows = await listPaymentMethodsSourceForExport({ ...rest, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = ["שם", "סוג", "פעיל", "שימושים", "תאריך יצירה"];
    const data = rows.map((r) => [
      r.nameHe,
      r.typeLabel,
      r.isActive ? "פעיל" : "לא פעיל",
      String(r.usageCount),
      r.createdAtYmd,
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`אמצעי תשלום · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `payment_methods_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `payment_methods_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
