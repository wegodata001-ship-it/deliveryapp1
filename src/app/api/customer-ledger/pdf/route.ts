import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { requireAuth } from "@/lib/admin-auth";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import {
  LEDGER_PDF_FAILED_MESSAGE,
  buildLedgerPdfDownloadFilename,
  ledgerPdfContentDisposition,
  type CustomerLedgerExportMeta,
  type LedgerPdfMode,
} from "@/lib/customer-ledger-export";
import { renderHtmlToPdf } from "@/lib/pdf/browser";

export const runtime = "nodejs";

type PdfRequestBody = {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
  mode?: LedgerPdfMode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePdfMode(value: unknown): LedgerPdfMode {
  return value === "detailed" ? "detailed" : "regular";
}

function parseBody(value: unknown): PdfRequestBody | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.meta) || !isRecord(value.ledger)) return null;
  if (!Array.isArray(value.ledger.rows)) return null;
  return {
    meta: value.meta as CustomerLedgerExportMeta,
    ledger: value.ledger as CustomerLedgerPayload,
    mode: parsePdfMode(value.mode),
  };
}

async function loadHebrewFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
}

export async function POST(req: Request): Promise<Response> {
  try {
    await requireAuth();

    const body = parseBody(await req.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid ledger PDF payload" }, { status: 400 });
    }

    const mode = body.mode ?? "regular";
    const fontBase64 = await loadHebrewFont();
    const html = buildCustomerLedgerPdfHtml({
      meta: body.meta,
      ledger: body.ledger,
      mode,
      font: {
        family: "Noto Sans Hebrew",
        mimeType: "font/ttf",
        base64: fontBase64,
      },
    });

    const filename = buildLedgerPdfDownloadFilename({
      customerCode: body.meta.customerCode,
      variant: "full",
    });
    const pdfBytes = await renderHtmlToPdf(html);

    if (!pdfBytes) {
      console.error("[customer-ledger-pdf] chromium returned no PDF bytes", {
        customerCode: body.meta.customerCode,
        rowCount: body.ledger.rows?.length ?? 0,
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
    console.error("[customer-ledger-pdf] failed", e);
    return NextResponse.json({ ok: false, error: LEDGER_PDF_FAILED_MESSAGE }, { status: 500 });
  }
}
