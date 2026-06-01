"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  getPaymentSourcePreview,
  getPaymentsSourceKpis,
  listPaymentsSourceForExport,
  listPaymentsSourceTable,
  type PaymentsSourceFilters,
  type PaymentsSourceListQuery,
} from "@/lib/payments-source-table";

async function ensurePaymentsTableAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type PaymentsSourceListPayload = Awaited<ReturnType<typeof listPaymentsSourceTable>> & {
  kpis: Awaited<ReturnType<typeof getPaymentsSourceKpis>>;
};

export async function listPaymentsSourceTableAction(
  query: PaymentsSourceListQuery & { search?: string },
): Promise<PaymentsSourceListPayload> {
  await ensurePaymentsTableAccess();
  const { search, ...rest } = query;
  const filters: PaymentsSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  const [list, kpis] = await Promise.all([
    listPaymentsSourceTable({ ...rest, filters }),
    getPaymentsSourceKpis(filters),
  ]);
  return { ...list, kpis };
}

export async function getPaymentSourcePreviewAction(
  customerId: string,
): Promise<Awaited<ReturnType<typeof getPaymentSourcePreview>>> {
  await ensurePaymentsTableAccess();
  return getPaymentSourcePreview(customerId);
}

export type PaymentsExportKind = "excel" | "pdf";

export async function exportPaymentsSourceAction(
  query: PaymentsSourceListQuery & { search?: string },
  kind: PaymentsExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensurePaymentsTableAccess();
    const { search, ...rest } = query;
    const filters: PaymentsSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const { page: _page, limit: _limit, ...exportQuery } = rest;
    const rows = await listPaymentsSourceForExport({ ...exportQuery, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = ["מספר תשלום", "לקוח", "קוד לקוח", "תאריך", "דולר", "שקלים", "אמצעי תשלום"];
    const data = rows.map((r) => [
      r.paymentCode,
      r.customerName,
      r.customerCode,
      r.paymentDateYmd,
      r.usd,
      r.ils,
      r.methodLabel,
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`דוח תשלומים · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `payments_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `payments_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
