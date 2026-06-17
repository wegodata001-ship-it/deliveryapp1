import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { CustomerLedgerPayload } from "@/app/admin/capture/actions";
import { requireAuth } from "@/lib/admin-auth";
import { buildCustomerLedgerPdfHtml } from "@/lib/customer-ledger-pdf-html";
import type { CustomerLedgerExportMeta } from "@/lib/customer-ledger-export";

export const runtime = "nodejs";

type PdfRequestBody = {
  meta: CustomerLedgerExportMeta;
  ledger: CustomerLedgerPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseBody(value: unknown): PdfRequestBody | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.meta) || !isRecord(value.ledger)) return null;
  if (!Array.isArray(value.ledger.rows)) return null;
  return value as PdfRequestBody;
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

    const fontBase64 = await loadHebrewFont();
    const html = buildCustomerLedgerPdfHtml({
      meta: body.meta,
      ledger: body.ledger,
      font: {
        family: "Noto Sans Hebrew",
        mimeType: "font/ttf",
        base64: fontBase64,
      },
    });

    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

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

      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="ledger.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (e) {
    console.error("[customer-ledger-pdf] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 },
    );
  }
}
