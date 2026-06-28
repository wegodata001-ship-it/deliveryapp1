import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { renderHtmlToPdf } from "@/lib/pdf/browser";
import { buildCashControlPdfHtml } from "@/lib/controls/cash-control-pdf-html";
import { getCashExportData } from "@/app/admin/cash-control/export-data";

// ⚠️ Route זה מפיק PDF דרך שירות הדפדפן המרכזי (@/lib/pdf/browser → playwright-core + @sparticuz/chromium).
// ייצוא Excel נמצא ב-route נפרד (../excel) ואינו אורז את Chromium.

export const runtime = "nodejs";

const READ_PERMS = ["view_payment_control"];

async function loadHebrewFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as { week?: unknown } | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    if (!week) {
      return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    }

    const data = await getCashExportData(week);
    const baseName = `Cash_Control_${week.replace(/[^\w-]/g, "_")}`;

    const fontBase64 = await loadHebrewFont();
    const html = buildCashControlPdfHtml(data, {
      family: "Noto Sans Hebrew",
      mimeType: "font/ttf",
      base64: fontBase64,
    });
    const pdfBytes = await renderHtmlToPdf(html);

    if (pdfBytes) {
      return new Response(new Blob([new Uint8Array(pdfBytes)]), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${baseName}.html"`,
        "X-Cash-Pdf-Fallback": "html",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[cash-control-export-pdf] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
