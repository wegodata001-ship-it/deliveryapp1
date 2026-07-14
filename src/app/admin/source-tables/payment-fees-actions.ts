"use server";

import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import {
  getPaymentFeesSourceKpis,
  listPaymentFeesSourceForExport,
  listPaymentFeesSourceTable,
  type PaymentFeesSourceFilters,
  type PaymentFeesSourceListQuery,
} from "@/lib/payment-fees-source-table";

async function ensureAccess() {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["manage_settings"])) {
    throw new Error("אין הרשאה");
  }
  return me;
}

export type PaymentFeesSourceListPayload = Awaited<ReturnType<typeof listPaymentFeesSourceTable>> & {
  kpis: Awaited<ReturnType<typeof getPaymentFeesSourceKpis>>;
};

export async function listPaymentFeesSourceTableAction(
  query: PaymentFeesSourceListQuery & { search?: string },
): Promise<PaymentFeesSourceListPayload> {
  await ensureAccess();
  const { search, ...rest } = query;
  const filters: PaymentFeesSourceFilters = {
    ...(rest.filters ?? {}),
    ...(search?.trim() ? { search: search.trim() } : {}),
  };
  const [list, kpis] = await Promise.all([
    listPaymentFeesSourceTable({ ...rest, filters }),
    getPaymentFeesSourceKpis(filters),
  ]);
  return { ...list, kpis };
}

export type PaymentFeesExportKind = "excel" | "pdf" | "csv";

export async function exportPaymentFeesSourceAction(
  query: PaymentFeesSourceListQuery & { search?: string },
  kind: PaymentFeesExportKind,
): Promise<{ ok: true; base64: string; filename: string; mime: string } | { ok: false; error: string }> {
  try {
    await ensureAccess();
    const { search, ...rest } = query;
    const filters: PaymentFeesSourceFilters = {
      ...(rest.filters ?? {}),
      ...(search?.trim() ? { search: search.trim() } : {}),
    };
    const { page: _p, limit: _l, ...exportQuery } = rest;
    const rows = await listPaymentFeesSourceForExport({ ...exportQuery, filters });
    if (rows.length === 0) return { ok: false, error: "אין שורות לייצוא" };

    const headers = [
      "תאריך",
      "לקוח",
      "קוד לקוח",
      "מסמך מקור",
      "קליטת תשלום",
      "אמצעי תשלום",
      "סכום ($)",
      "סיבת יצירה",
      "סטטוס",
      "משתמש יוצר",
      "תאריך סגירה",
    ];
    const data = rows.map((r) => [
      r.createdAtYmd,
      r.customerName,
      r.customerCode,
      r.sourceDocumentCode,
      r.paymentCaptureCode,
      r.paymentMethodLabel,
      r.amountUsd,
      r.reasonLabel,
      r.statusLabel,
      r.createdByName,
      r.closedAtYmd,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);

    if (kind === "csv") {
      const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [headers.map(escape).join(","), ...data.map((row) => row.map(escape).join(","))];
      const csv = "\uFEFF" + lines.join("\n");
      return {
        ok: true,
        base64: Buffer.from(csv, "utf-8").toString("base64"),
        filename: `payment_fees_${stamp}.csv`,
        mime: "text/csv; charset=utf-8",
      };
    }

    if (kind === "excel") {
      const { generateExcel } = await import("@/lib/reports-excel");
      const buf = generateExcel(headers, data, [[`עמלות / הפרשי התאמה · ${stamp}`]]);
      return {
        ok: true,
        base64: Buffer.from(buf).toString("base64"),
        filename: `payment_fees_${stamp}.xlsx`,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const { buildCustomersExportHtml } = await import("@/lib/customers-source-export-pdf");
    const html = buildCustomersExportHtml(headers, data, stamp);
    return {
      ok: true,
      base64: Buffer.from(html, "utf-8").toString("base64"),
      filename: `payment_fees_${stamp}.html`,
      mime: "text/html; charset=utf-8",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" };
  }
}
