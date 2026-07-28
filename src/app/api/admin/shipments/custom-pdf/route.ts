import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { recordActivityAudit } from "@/lib/activity-audit";
import { renderHtmlToPdf } from "@/lib/pdf/browser";
import {
  buildCustomShipmentPdfHtml,
  type CustomPdfColumnKey,
  type CustomPdfOptions,
  type CustomPdfSummaryLine,
  CUSTOM_PDF_COLUMNS,
  DEFAULT_CUSTOM_PDF_OPTIONS,
} from "@/lib/shipment-custom-pdf";

export const runtime = "nodejs";

const PERMS = ["manage_shipments", "view_shipments"];

type Body = {
  columns?: Array<{ key: string; label: string }>;
  rows?: string[][];
  options?: Partial<CustomPdfOptions>;
  summary?: CustomPdfSummaryLine[];
  disposition?: "inline" | "attachment";
};

async function loadLogoDataUri(): Promise<string | null> {
  try {
    const logoPath = path.join(process.cwd(), "public", "brand", "wego-w-icon.svg");
    const bytes = await readFile(logoPath);
    return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const allowedKeys = new Set(CUSTOM_PDF_COLUMNS.map((c) => c.key));
    const columns = (body?.columns ?? [])
      .filter((c) => c?.key && allowedKeys.has(c.key as CustomPdfColumnKey))
      .map((c) => ({
        key: c.key as CustomPdfColumnKey,
        label:
          c.label?.trim() ||
          CUSTOM_PDF_COLUMNS.find((d) => d.key === c.key)?.label ||
          c.key,
      }));

    const rows = Array.isArray(body?.rows) ? body!.rows! : [];
    if (columns.length === 0) {
      return NextResponse.json(
        { ok: false, error: "יש לבחור לפחות עמודה אחת." },
        { status: 400 },
      );
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "אין שורות להפקה." },
        { status: 400 },
      );
    }

    const options: CustomPdfOptions = {
      ...DEFAULT_CUSTOM_PDF_OPTIONS,
      ...(body?.options ?? {}),
      pageSize: "A4",
      title: (body?.options?.title ?? DEFAULT_CUSTOM_PDF_OPTIONS.title).trim() || "דוח משלוחים",
    };

    const logoDataUri = options.showLogo ? await loadLogoDataUri() : null;
    const generatedAt = new Date();
    const html = buildCustomShipmentPdfHtml({
      columns,
      rows: rows.map((r) =>
        columns.map((_, i) => String(r[i] ?? "—")),
      ),
      options,
      summary: body?.summary ?? [],
      logoDataUri,
      generatedAt,
    });

    const disposition = body?.disposition === "attachment" ? "attachment" : "inline";
    const pdfBytes = await renderHtmlToPdf(html, {
      locale: options.rtl ? "he-IL" : "en-US",
      landscape: options.landscape,
      preferCSSPageSize: true,
      margin: options.showPageNumbers
        ? { top: "0", right: "0", bottom: "14mm", left: "0" }
        : { top: "0", right: "0", bottom: "0", left: "0" },
      displayHeaderFooter: options.showPageNumbers,
      footerTemplate: options.showPageNumbers
        ? `<div style="width:100%;font-size:9px;text-align:center;color:#64748b;font-family:Segoe UI,Tahoma,sans-serif;padding:0 10mm;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`
        : "<span></span>",
    });

    recordActivityAudit({
      userId: me.id,
      actionType: "SHIPMENT_CUSTOM_PDF",
      entityType: "ShipmentRecord",
      entityId: null,
      metadata: {
        columnKeys: columns.map((c) => c.key),
        rowCount: rows.length,
        options,
        generatedAt: generatedAt.toISOString(),
        generatedById: me.id,
      },
    });

    const stamp = generatedAt.toISOString().slice(0, 10);
    const filename = `shipments-custom-${stamp}.pdf`;

    if (pdfBytes) {
      return new Response(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposition}; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `${disposition}; filename="${filename.replace(/\.pdf$/, ".html")}"`,
        "X-Custom-Pdf-Fallback": "html",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[custom-pdf] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "הפקת PDF נכשלה" },
      { status: 500 },
    );
  }
}
