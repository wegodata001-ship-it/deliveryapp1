"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  getCustomerSourcePreview,
  getCustomersSourceKpisCached,
  listCustomersSourceForExport,
  listCustomersSourceTable,
  type CustomersSourceFilters,
  type CustomersSourceListQuery,
} from "@/lib/customers-source-table";

async function ensureCustomersTableAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type CustomersSourceListPayload = Awaited<ReturnType<typeof listCustomersSourceTable>> & {
  kpis: Awaited<ReturnType<typeof getCustomersSourceKpisCached>>;
};

export async function listCustomersSourceTableAction(
  query: CustomersSourceListQuery & { search?: string },
): Promise<CustomersSourceListPayload> {
  await ensureCustomersTableAccess();
  const { search, ...rest } = query;
  const filters: CustomersSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  const [list, kpis] = await Promise.all([
    listCustomersSourceTable({ ...rest, filters }),
    getCustomersSourceKpisCached(),
  ]);
  return { ...list, kpis };
}

export async function getCustomerSourcePreviewAction(
  customerId: string,
): Promise<Awaited<ReturnType<typeof getCustomerSourcePreview>>> {
  await ensureCustomersTableAccess();
  return getCustomerSourcePreview(customerId);
}

export type CustomersExportKind = "excel" | "pdf";

export async function exportCustomersSourceAction(
  query: CustomersSourceListQuery & { search?: string },
  kind: CustomersExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensureCustomersTableAccess();
    const { search, ...rest } = query;
    const filters: CustomersSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const { page: _page, limit: _limit, ...exportQuery } = rest;
    const rows = await listCustomersSourceForExport({ ...exportQuery, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = ["קוד", "שם", "טלפון", "אימייל", "יתרת לקוח (USD)", "תאריך הצטרפות"];
    const data = rows.map((r) => [
      r.code,
      r.name,
      r.phone,
      r.email,
      r.balanceUsd,
      r.created,
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`דוח לקוחות · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `customers_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `customers_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
