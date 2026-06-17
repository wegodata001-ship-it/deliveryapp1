import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { requireAuth } from "@/lib/admin-auth";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import {
  buildLedgerExportFilename,
  type CustomerLedgerExportMeta,
  type LedgerPdfMode,
} from "@/lib/customer-ledger-export";
import { launchPdfBrowser } from "@/lib/playwright-pdf-browser";

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

async function renderLedgerPdfBytes(html: string): Promise<Uint8Array | null> {
  try {
    const browser = await launchPdfBrowser();
    try {
      const page = await browser.newPage({ locale: "he-IL" });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      return new Uint8Array(pdf);
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    console.warn("[customer-ledger-pdf] playwright render failed — HTML fallback", error);
    return null;
  }
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

    const filename = buildLedgerExportFilename(body.meta.customerCode, "pdf", mode);
    const pdfBytes = await renderLedgerPdfBytes(html);

    if (pdfBytes) {
      return new Response(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const htmlFilename = filename.replace(/\.pdf$/i, ".html");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${htmlFilename}"`,
        "X-Ledger-Pdf-Fallback": "html",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[customer-ledger-pdf] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 },
    );
  }
}
