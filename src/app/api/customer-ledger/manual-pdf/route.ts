import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import { applyManualLedgerSelection } from "@/lib/customer-ledger-manual-pdf";
import {
  LEDGER_PDF_FAILED_MESSAGE,
  buildLedgerPdfDownloadFilename,
  ledgerPdfContentDisposition,
  type CustomerLedgerExportMeta,
} from "@/lib/customer-ledger-export";
import { renderHtmlToPdf } from "@/lib/pdf/browser";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function loadHebrewFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_customer_card", "view_customers", "create_orders", "edit_orders"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ ok: false, error: "Invalid manual PDF payload" }, { status: 400 });
    }

    const customerId = asString(body.customerId);
    const selectedRowIds = Array.isArray(body.selectedRowIds)
      ? body.selectedRowIds.map((id) => asString(id)).filter(Boolean)
      : [];
    if (!customerId) {
      return NextResponse.json({ ok: false, error: "חסר לקוח" }, { status: 400 });
    }
    if (selectedRowIds.length === 0) {
      return NextResponse.json({ ok: false, error: "לא נבחרו שורות" }, { status: 400 });
    }

    const { buildCustomerAccountLedger } = await import("@/lib/customer-account-ledger");
    const ledger = await buildCustomerAccountLedger({
      customerId,
      fromYmd: asString(body.fromYmd) || null,
      toYmd: asString(body.toYmd) || null,
      sourceCountry: asString(body.sourceCountry) || null,
    });
    if (!ledger) {
      return NextResponse.json({ ok: false, error: "לא נמצאה כרטסת" }, { status: 404 });
    }

    const selected = applyManualLedgerSelection(ledger, selectedRowIds);
    if (!selected.ok) {
      return NextResponse.json({ ok: false, error: "BLOCKED" }, { status: 403 });
    }

    const meta = (isRecord(body.meta) ? body.meta : {}) as Partial<CustomerLedgerExportMeta>;
    const exportMeta: CustomerLedgerExportMeta = {
      displayName: asString(meta.displayName),
      customerCode: asString(meta.customerCode),
      phone: asString(meta.phone) || null,
      email: asString(meta.email) || null,
      city: asString(meta.city) || null,
      sourceCountry: asString(body.sourceCountry) || null,
      fromYmd: selected.summary.fromYmd,
      toYmd: selected.summary.toYmd,
      sortLabel: "ישן → חדש",
    };

    const fontBase64 = await loadHebrewFont();
    const html = buildCustomerLedgerPdfHtml({
      meta: exportMeta,
      ledger: selected.ledger,
      mode: "regular",
      selection: selected.summary,
      font: {
        family: "Noto Sans Hebrew",
        mimeType: "font/ttf",
        base64: fontBase64,
      },
    });

    const filename = buildLedgerPdfDownloadFilename({
      customerCode: exportMeta.customerCode || "customer",
      variant: "manual",
    });
    const pdfBytes = await renderHtmlToPdf(html);
    if (!pdfBytes) {
      console.error("[customer-ledger-manual-pdf] chromium returned no PDF bytes", {
        customerId,
        selectedCount: selectedRowIds.length,
      });
      return NextResponse.json({ ok: false, error: LEDGER_PDF_FAILED_MESSAGE }, { status: 500 });
    }

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": ledgerPdfContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[customer-ledger-manual-pdf] failed", e);
    return NextResponse.json({ ok: false, error: LEDGER_PDF_FAILED_MESSAGE }, { status: 500 });
  }
}
